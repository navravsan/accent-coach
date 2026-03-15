import type { Express, Request, Response } from "express";
import { registerAuthRoutes } from "./auth";
import { createServer, type Server } from "node:http";
import { openai, speechToText, textToSpeech, ensureCompatibleFormat, convertToWav } from "./replit_integrations/audio/client";
import { assessPronunciation, assessWord as azureAssessWord, type AzureWordResult } from "./azure-speech";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { writeFile, readFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function ensureWav16k(rawBuffer: Buffer): Promise<Buffer> {
  const { buffer } = await ensureCompatibleFormat(rawBuffer);
  return buffer;
}

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z']/g, "");
}

function findMatchingArticleSection(transcript: string, fullArticle: string): string {
  const transcriptWords = transcript.split(/\s+/).map(normalizeWord).filter(w => w.length > 0);
  const articleWords = fullArticle.split(/\s+/).filter(w => w.trim().length > 0);
  const articleNorm = articleWords.map(normalizeWord);

  if (transcriptWords.length === 0 || articleWords.length === 0) return transcript;

  const windowSize = Math.min(transcriptWords.length, articleWords.length);
  let bestStart = 0;
  let bestScore = -1;

  for (let start = 0; start <= articleWords.length - Math.min(windowSize, articleWords.length); start++) {
    let score = 0;
    const end = Math.min(start + windowSize, articleWords.length);
    const windowNorm = articleNorm.slice(start, end);

    let tIdx = 0;
    for (let aIdx = 0; aIdx < windowNorm.length && tIdx < transcriptWords.length; aIdx++) {
      if (windowNorm[aIdx] === transcriptWords[tIdx] || 
          (windowNorm[aIdx].length >= 4 && transcriptWords[tIdx].length >= 4 && 
           windowNorm[aIdx].slice(0, 4) === transcriptWords[tIdx].slice(0, 4))) {
        score++;
        tIdx++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const sliceStart = bestStart;
  const sliceEnd = Math.min(articleWords.length, bestStart + windowSize);
  const matched = articleWords.slice(sliceStart, sliceEnd).join(" ");

  console.log(`[Reference Match] transcript=${transcriptWords.length} words, matched article[${sliceStart}:${sliceEnd}] = ${sliceEnd - sliceStart} words (sequential match=${bestScore}/${transcriptWords.length})`);

  return matched;
}

async function extractWordAudio(
  wavBuffer: Buffer,
  word: AzureWordResult
): Promise<string | null> {
  if (word.offset === 0 && word.duration === 0) return null;
  if (word.errorType === "Omission" || word.errorType === "Insertion") return null;

  const startSec = Math.max(0, word.offset / 10_000_000 - 0.15);
  const durSec = word.duration / 10_000_000 + 0.3;

  const dir = await mkdtemp(join(tmpdir(), "wordaudio-"));
  const inPath = join(dir, "input.wav");
  const outPath = join(dir, "output.wav");

  try {
    await writeFile(inPath, wavBuffer);
    await new Promise<void>((resolve, reject) => {
      execFile("ffmpeg", [
        "-y", "-i", inPath,
        "-ss", startSec.toFixed(3),
        "-t", durSec.toFixed(3),
        "-ar", "16000", "-ac", "1",
        "-f", "wav", outPath,
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const outBuf = await readFile(outPath);
    return outBuf.toString("base64");
  } catch (err) {
    console.error(`Failed to extract audio for word "${word.word}":`, err);
    return null;
  } finally {
    try { await unlink(inPath); } catch {}
    try { await unlink(outPath); } catch {}
    try { const { rmdir } = await import("node:fs/promises"); await rmdir(dir); } catch {}
  }
}

function parseGptScoringResponse(raw: string): { overallScore: number; words: Array<{ word: string; score: number; tip: string; problemPart: string; phonetic: string }> } | null {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  let result: any = null;
  try {
    result = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) try { result = JSON.parse(m[0]); } catch {}
  }
  if (!result) return null;
  return {
    overallScore: Math.round(result.overallScore ?? 75),
    words: (result.words || []).map((w: any) => ({
      word: w.word,
      score: Math.round(w.score ?? 75),
      tip: w.tip || "",
      problemPart: w.problemPart || "",
      phonetic: w.phonetic || "",
    })),
  };
}

const CALIFORNIA_ACCENT_SYSTEM_PROMPT = `You are a professional California accent coach with phonetics expertise.
Your job: listen to the speaker's audio and score EVERY word (4+ letters) against standard California English (General American West Coast).

Scoring guide (be strict — this is a training tool):
- 95–100: Indistinguishable from a native California speaker
- 80–94: Very good, very minor accent feature
- 60–79: Noticeable non-native pronunciation — flag it
- 40–59: Clear pronunciation error — vowels, consonants, or stress wrong
- 0–39: Significantly wrong — would confuse a native listener

Key California English features to assess against:
- The "cot-caught" merger: "lot" and "thought" share the same vowel /ɑː/
- Non-rhotic? NO — California IS rhotic, "r" is always pronounced
- Flat front vowels: "bad" /bæd/ with a wide open /æ/
- T-flapping between vowels: "butter" → /ˈbʌɾər/, "city" → /ˈsɪɾi/
- Function word reduction: "to" → /tə/, "and" → /ən/
- Stress patterns in multi-syllable words must match General American
- "th" sounds: voiced /ð/ in "the/this/that", voiceless /θ/ in "think/three"
- Word-final consonants should not be dropped
- No retroflex or dental consonants from other accent systems

Flag EVERY word (4+ letters) where the speaker's pronunciation noticeably deviates.
Include words even if the score is 70–80 — they need coaching feedback.

For each flagged word provide:
- "phonetic": IPA for the correct California pronunciation  
- "problemPart": the exact syllable/letters the speaker got wrong (e.g. "th", "tion", "-ing")
- "tip": one specific actionable instruction (e.g. "Place tongue behind top teeth for 'th', not between teeth")

Calculate overallScore = average of ALL word scores in the transcript (not just flagged words). Be calibrated — a non-native speaker reading normally should score 55–80. Near-native: 80–90. True native: 90+.

Respond ONLY with valid JSON, no markdown:
{"overallScore": 68, "words": [{"word": "example", "score": 62, "phonetic": "/ɪɡˈzæmpəl/", "problemPart": "zam", "tip": "Stress the second syllable and flatten the 'a': ex-ZAM-pul"}]}`;

async function audioBasedAssessment(
  wavBuffer: Buffer,
  transcript: string,
  referenceText: string
): Promise<{
  overallScore: number;
  words: Array<{ word: string; score: number; tip: string; problemPart: string; phonetic: string }>;
}> {
  const audioBase64 = wavBuffer.toString("base64");

  console.log(`[GPT-Audio] Assessing ${transcript.split(/\s+/).length} words with gpt-4o-audio-preview...`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-audio-preview",
    messages: [
      {
        role: "system",
        content: CALIFORNIA_ACCENT_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "input_audio" as any,
            input_audio: { data: audioBase64, format: "wav" },
          },
          {
            type: "text",
            text: `The speaker was reading this text aloud:\n"${referenceText || transcript}"\n\nWhisper transcription of what was said: "${transcript}"\n\nAssess their California English pronunciation.`,
          },
        ] as any,
      },
    ],
    max_tokens: 2000,
    temperature: 0.2,
  });

  const raw = response.choices[0]?.message?.content || "";
  console.log(`[GPT-Audio] Raw response length: ${raw.length}`);
  const result = parseGptScoringResponse(raw);

  if (!result) {
    throw new Error("Failed to parse GPT audio response");
  }

  console.log(`[GPT-Audio] overallScore=${result.overallScore}, words=${result.words.length}`);
  return result;
}

async function gptTextFallbackScoring(transcript: string): Promise<{
  overallScore: number;
  words: Array<{ word: string; score: number; tip: string; problemPart: string; phonetic: string }>;
}> {
  console.log(`[GPT-Text] Falling back to text-only scoring...`);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a California accent coach. Given only a transcript (no audio), estimate pronunciation difficulty for a non-native English speaker reading this text aloud.

Score each word (4+ letters) 0–100 against California English:
- Score based on known pronunciation challenges for non-native speakers
- Flag words with complex consonant clusters, unusual stress, tricky vowels, "th" sounds, silent letters
- Be realistic: most non-native speakers score 55–75 on challenging passages
- overallScore = average of all words

Provide phonetic (IPA), problemPart (specific letters), and actionable tips.
Respond ONLY with JSON:
{"overallScore": 68, "words": [{"word": "example", "score": 62, "phonetic": "/ɪɡˈzæmpəl/", "problemPart": "zam", "tip": "Stress second syllable: ex-ZAM-pul"}]}`,
      },
      { role: "user", content: `Transcript: "${transcript}"` },
    ],
    max_tokens: 1500,
    temperature: 0.3,
  });

  const raw = response.choices[0]?.message?.content || "";
  const result = parseGptScoringResponse(raw);
  if (!result) return { overallScore: 70, words: [] };
  return result;
}

async function enrichWordsWithTips(
  words: Array<{ word: string; score: number; errorType: string }>
): Promise<Array<{ word: string; score: number; tip: string; problemPart: string; phonetic: string }>> {
  const needsTips = words.filter(w => w.word.length >= 4 && w.score < 85 && w.errorType !== "Omission");

  if (needsTips.length === 0) {
    return words
      .filter(w => w.word.length >= 4 && w.errorType !== "Omission" && w.errorType !== "Insertion")
      .map(w => ({
        word: w.word,
        score: w.score,
        tip: "",
        problemPart: "",
        phonetic: "",
      }));
  }

  const wordList = needsTips.map(w => `${w.word} (score: ${w.score})`).join(", ");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a pronunciation coach specializing in General American English — specifically the accent of a native English speaker born and raised in California, USA. For each word with a low pronunciation score, provide:
1. "phonetic": IPA transcription reflecting standard Californian/General American pronunciation
2. "problemPart": the specific syllable/letters likely mispronounced (lowercase)
3. "tip": a brief, actionable pronunciation tip referencing how a native Californian speaker would say it

Respond with ONLY a JSON object (no markdown):
{"words": [{"word": "example", "phonetic": "/ɪɡˈzæmpəl/", "problemPart": "zam", "tip": "Stress the second syllable"}]}`,
        },
        {
          role: "user",
          content: `Provide pronunciation tips for these words that scored low: ${wordList}`,
        },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const raw = response.choices[0]?.message?.content || "";
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    let tips: any = null;
    try {
      tips = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) try { tips = JSON.parse(m[0]); } catch {}
    }

    const tipMap = new Map<string, any>();
    if (tips?.words) {
      for (const t of tips.words) {
        tipMap.set(t.word.toLowerCase(), t);
      }
    }

    return words
      .filter(w => w.word.length >= 4 && w.errorType !== "Omission" && w.errorType !== "Insertion")
      .map(w => {
        const tipData = tipMap.get(w.word.toLowerCase());
        return {
          word: w.word,
          score: w.score,
          tip: tipData?.tip || "",
          problemPart: tipData?.problemPart || "",
          phonetic: tipData?.phonetic || "",
        };
      });
  } catch (err) {
    console.error("Error enriching words with tips:", err);
    return words
      .filter(w => w.word.length >= 4 && w.errorType !== "Omission" && w.errorType !== "Insertion")
      .map(w => ({
        word: w.word,
        score: w.score,
        tip: "",
        problemPart: "",
        phonetic: "",
      }));
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/analyze-speech", async (req: Request, res: Response) => {
    try {
      const { audio, referenceText } = req.body;
      if (!audio) {
        return res.status(400).json({ error: "Audio data is required" });
      }

      const rawBuffer = Buffer.from(audio, "base64");
      const wavBuffer = await ensureWav16k(rawBuffer);

      const transcript = await speechToText(wavBuffer, "wav");

      if (!transcript || transcript.trim().length === 0) {
        return res.json({
          overallScore: 0,
          transcript: "",
          words: [],
        });
      }

      let azureRef: string;
      if (referenceText && referenceText.trim().length > 0) {
        azureRef = findMatchingArticleSection(transcript, referenceText);
      } else {
        azureRef = transcript;
      }
      console.log(`[Azure] Assessing pronunciation (${transcript.split(/\s+/).length} words, ref=${azureRef.split(/\s+/).length} words from ${referenceText ? 'matched article section' : 'transcript'})...`);

      let overallScore: number;
      let wordsWithAudio: Array<any>;
      let usedFallback = false;

      try {
        const azureResult = await assessPronunciation(wavBuffer, azureRef);
        console.log(`[Azure] Overall: accuracy=${azureResult.accuracyScore}, fluency=${azureResult.fluencyScore}, pron=${azureResult.pronScore}`);

        const zeroWords = azureResult.words.filter(w => w.accuracyScore === 0);
        if (zeroWords.length > 0) {
          console.log(`[Azure] ${zeroWords.length} words with 0% score:`, zeroWords.map(w => `${w.word}(${w.errorType})`).join(", "));
        }

        const azureWords = azureResult.words
          .filter(w => w.errorType !== "Omission" && w.errorType !== "Insertion" && !(w.accuracyScore === 0 && (w.offset === 0 && w.duration === 0)))
          .map(w => ({
            word: w.word,
            score: w.accuracyScore,
            errorType: w.errorType,
          }));

        const enrichedWords = await enrichWordsWithTips(azureWords);

        const wordsNeedingAudio = azureResult.words.filter(
          w => w.word.length >= 4 && w.accuracyScore > 0 && w.accuracyScore < 85 && w.errorType !== "Omission" && w.errorType !== "Insertion"
        );
        const audioExtractions = await Promise.all(
          wordsNeedingAudio.map(async (w) => ({
            word: w.word.toLowerCase(),
            audio: await extractWordAudio(wavBuffer, w),
          }))
        );
        const audioMap = new Map<string, string>();
        for (const a of audioExtractions) {
          if (a.audio) audioMap.set(a.word, a.audio);
        }

        wordsWithAudio = enrichedWords.map(w => ({
          ...w,
          userAudio: audioMap.get(w.word.toLowerCase()) || undefined,
        }));

        const scoredWords = azureResult.words.filter(w => w.errorType !== "Omission" && w.errorType !== "Insertion" && w.accuracyScore > 0);
        overallScore = scoredWords.length > 0
          ? Math.round(scoredWords.reduce((sum, w) => sum + w.accuracyScore, 0) / scoredWords.length)
          : Math.round(azureResult.pronScore);

      } catch (azureErr: any) {
        console.warn(`[Azure] Failed (${azureErr.message}), using audio-based GPT assessment`);
        usedFallback = true;
        try {
          const audioResult = await audioBasedAssessment(wavBuffer, transcript, azureRef);
          overallScore = audioResult.overallScore;
          wordsWithAudio = audioResult.words;
        } catch (audioErr: any) {
          console.warn(`[GPT-Audio] Failed (${audioErr.message}), falling back to text-only scoring`);
          const textResult = await gptTextFallbackScoring(transcript);
          overallScore = textResult.overallScore;
          wordsWithAudio = textResult.words;
        }
      }

      console.log(`[Result] overallScore=${overallScore}, words=${wordsWithAudio.length}, fallback=${usedFallback}`);

      res.json({
        overallScore,
        transcript,
        words: wordsWithAudio,
        fallback: usedFallback,
      });
    } catch (error) {
      console.error("Error analyzing speech:", error);
      res.status(500).json({ error: "Failed to analyze speech" });
    }
  });

  app.post("/api/analyze-chunk", async (req: Request, res: Response) => {
    try {
      const { audio, referenceText } = req.body;
      if (!audio) {
        return res.status(400).json({ error: "Audio data is required" });
      }

      const rawBuffer = Buffer.from(audio, "base64");
      const wavBuffer = await ensureWav16k(rawBuffer);

      const transcript = await speechToText(wavBuffer, "wav");

      if (!transcript || transcript.trim().length === 0) {
        return res.json({ transcript: "", words: [] });
      }

      const words = transcript.replace(/[^\w\s'-]/g, "").split(/\s+/).filter(Boolean);
      const longWords = words.filter(w => w.length >= 4);

      if (longWords.length === 0) {
        return res.json({ transcript, words: [] });
      }

      let azureRef: string;
      if (referenceText && referenceText.trim().length > 0) {
        azureRef = findMatchingArticleSection(transcript, referenceText);
      } else {
        azureRef = transcript;
      }
      console.log(`[Azure Chunk] Assessing ${words.length} words (ref=${azureRef.split(/\s+/).length} words from ${referenceText ? 'matched article section' : 'transcript'})...`);

      let chunkWords: Array<any>;

      try {
        const azureResult = await assessPronunciation(wavBuffer, azureRef);
        console.log(`[Azure Chunk] accuracy=${azureResult.accuracyScore}, fluency=${azureResult.fluencyScore}`);

        const azureWords = azureResult.words
          .filter(w => w.errorType !== "Omission" && w.errorType !== "Insertion" && !(w.accuracyScore === 0 && (w.offset === 0 && w.duration === 0)))
          .map(w => ({
            word: w.word,
            score: w.accuracyScore,
            errorType: w.errorType,
          }));

        const enrichedWords = await enrichWordsWithTips(azureWords);

        const wordsNeedingAudio = azureResult.words.filter(
          w => w.word.length >= 4 && w.accuracyScore < 85 && w.errorType !== "Omission" && w.errorType !== "Insertion" && w.accuracyScore > 0
        );
        const audioExtractions = await Promise.all(
          wordsNeedingAudio.map(async (w) => ({
            word: w.word.toLowerCase(),
            audio: await extractWordAudio(wavBuffer, w),
          }))
        );
        const audioMap = new Map<string, string>();
        for (const a of audioExtractions) {
          if (a.audio) audioMap.set(a.word, a.audio);
        }

        chunkWords = enrichedWords.map(w => ({
          ...w,
          userAudio: audioMap.get(w.word.toLowerCase()) || undefined,
        }));
      } catch (azureErr: any) {
        console.warn(`[Azure Chunk] Failed (${azureErr.message}), using audio-based GPT assessment`);
        try {
          const audioResult = await audioBasedAssessment(wavBuffer, transcript, azureRef);
          chunkWords = audioResult.words;
        } catch (audioErr: any) {
          console.warn(`[GPT-Audio Chunk] Failed (${audioErr.message}), falling back to text-only`);
          const textResult = await gptTextFallbackScoring(transcript);
          chunkWords = textResult.words;
        }
      }

      res.json({ transcript, words: chunkWords });
    } catch (error) {
      console.error("Error analyzing chunk:", error);
      res.status(500).json({ error: "Failed to analyze chunk" });
    }
  });

  app.get("/api/reading-article", async (_req: Request, res: Response) => {
    try {
      const topics = [
        "agile product development",
        "user research methods",
        "product-market fit",
        "sprint planning best practices",
        "building an MVP",
        "customer feedback loops",
        "feature prioritization frameworks",
        "cross-functional team collaboration",
        "product roadmap strategies",
        "A/B testing for product decisions",
        "OKRs for product teams",
        "design thinking in product management",
        "technical debt management",
        "stakeholder communication",
        "growth metrics and KPIs",
      ];
      const topic = topics[Math.floor(Math.random() * topics.length)];

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Write a short, engaging article about a tech product management topic. The article should be exactly 15-20 lines long (each line being a natural sentence). Write in clear, professional English that is great for reading aloud to practice pronunciation. Use varied vocabulary with some challenging words. Do NOT use markdown formatting, bullet points, or headers. Just write flowing paragraphs. Include a one-line title at the very start.`,
          },
          {
            role: "user",
            content: `Write a short article about: ${topic}`,
          },
        ],
        max_tokens: 600,
        temperature: 0.9,
      });

      const content = response.choices[0]?.message?.content || "";
      const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
      const title = lines[0] || topic;
      const body = lines.slice(1).join("\n");

      res.json({ title, body, topic });
    } catch (error) {
      console.error("Error generating article:", error);
      res.status(500).json({ error: "Failed to generate article" });
    }
  });

  app.post("/api/tts", async (req: Request, res: Response) => {
    try {
      const { word } = req.body;
      if (!word) {
        return res.status(400).json({ error: "Word is required" });
      }

      const audioBuffer = await textToSpeech(word, "nova", "wav");
      const base64Audio = audioBuffer.toString("base64");

      res.json({ audio: base64Audio });
    } catch (error) {
      console.error("Error generating TTS:", error);
      res.status(500).json({ error: "Failed to generate pronunciation" });
    }
  });

  app.post("/api/assess-word", async (req: Request, res: Response) => {
    try {
      const { audio, targetWord } = req.body;
      if (!audio || !targetWord) {
        return res.status(400).json({ error: "Audio and target word are required" });
      }

      const rawBuffer = Buffer.from(audio, "base64");
      const wavBuffer = await ensureWav16k(rawBuffer);

      console.log(`[Azure Word] Assessing pronunciation of "${targetWord}"...`);

      const azureResult = await azureAssessWord(wavBuffer, targetWord);
      console.log(`[Azure Word] score=${azureResult.score}, errorType=${azureResult.errorType}`);

      let feedback = "";
      if (azureResult.score < 85) {
        try {
          const tipResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a pronunciation coach specializing in General American English — specifically the accent of a native English speaker born and raised in California, USA. Give brief, actionable feedback for improving pronunciation to sound like a native Californian speaker. Return ONLY valid JSON: {"feedback": "your tip here"}`,
              },
              {
                role: "user",
                content: `The user tried to say "${targetWord}" and scored ${azureResult.score}/100. ${azureResult.phonemes ? `Phoneme scores: ${azureResult.phonemes.map(p => `${p.phoneme}=${p.score}`).join(", ")}` : ""}\nGive a brief tip to improve.`,
              },
            ],
            max_tokens: 128,
            temperature: 0.3,
          });

          const tipRaw = tipResponse.choices[0]?.message?.content || "";
          const tipCleaned = tipRaw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          try {
            const tipData = JSON.parse(tipCleaned);
            feedback = tipData.feedback || "";
          } catch {
            feedback = "Keep practicing this word.";
          }
        } catch {
          feedback = "Keep practicing this word.";
        }
      } else {
        feedback = "Great pronunciation!";
      }

      res.json({
        score: azureResult.score,
        feedback,
        transcript: targetWord,
      });
    } catch (error) {
      console.error("Error assessing word:", error);
      res.status(500).json({ error: "Failed to assess pronunciation" });
    }
  });

  registerAuthRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
