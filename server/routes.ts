import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { openai, speechToText, textToSpeech, ensureCompatibleFormat, convertToWav } from "./replit_integrations/audio/client";
import { assessPronunciation, assessWord as azureAssessWord } from "./azure-speech";
import { Buffer } from "node:buffer";

async function ensureWav16k(rawBuffer: Buffer): Promise<Buffer> {
  const { buffer } = await ensureCompatibleFormat(rawBuffer);
  return buffer;
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

      const azureRef = referenceText && referenceText.trim().length > 0 ? referenceText : transcript;
      console.log(`[Azure] Assessing pronunciation (${transcript.split(/\s+/).length} words, using ${referenceText ? 'article' : 'transcript'} as reference)...`);

      const azureResult = await assessPronunciation(wavBuffer, azureRef);
      console.log(`[Azure] Overall: accuracy=${azureResult.accuracyScore}, fluency=${azureResult.fluencyScore}, pron=${azureResult.pronScore}`);

      const azureWords = azureResult.words.map(w => ({
        word: w.word,
        score: w.accuracyScore,
        errorType: w.errorType,
      }));

      const enrichedWords = await enrichWordsWithTips(azureWords);

      const overallScore = Math.round(azureResult.pronScore);

      console.log(`[Result] overallScore=${overallScore}, words=${enrichedWords.length}`);

      res.json({
        overallScore,
        transcript,
        words: enrichedWords,
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

      const azureRef = referenceText && referenceText.trim().length > 0 ? referenceText : transcript;
      console.log(`[Azure Chunk] Assessing ${words.length} words (using ${referenceText ? 'article' : 'transcript'} as reference)...`);

      const azureResult = await assessPronunciation(wavBuffer, azureRef);
      console.log(`[Azure Chunk] accuracy=${azureResult.accuracyScore}, fluency=${azureResult.fluencyScore}`);

      const azureWords = azureResult.words.map(w => ({
        word: w.word,
        score: w.accuracyScore,
        errorType: w.errorType,
      }));

      const enrichedWords = await enrichWordsWithTips(azureWords);

      res.json({ transcript, words: enrichedWords });
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

  const httpServer = createServer(app);
  return httpServer;
}
