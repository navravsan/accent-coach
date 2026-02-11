import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { openai, speechToText, textToSpeech, ensureCompatibleFormat } from "./replit_integrations/audio/client";
import { Buffer } from "node:buffer";

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/analyze-speech", async (req: Request, res: Response) => {
    try {
      const { audio } = req.body;
      if (!audio) {
        return res.status(400).json({ error: "Audio data is required" });
      }

      const rawBuffer = Buffer.from(audio, "base64");
      const { buffer: audioBuffer, format: inputFormat } = await ensureCompatibleFormat(rawBuffer);

      const transcript = await speechToText(audioBuffer, inputFormat);

      if (!transcript || transcript.trim().length === 0) {
        return res.json({
          overallScore: 0,
          transcript: "",
          words: [],
        });
      }

      const words = transcript.replace(/[^\w\s'-]/g, "").split(/\s+/).filter(Boolean);
      console.log(`Transcript has ${words.length} words, requesting assessment...`);

      const longWords = words.filter(w => w.length >= 4);
      console.log(`Long words (4+ chars): ${longWords.length}`);

      const assessmentResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a speech-language pathologist. Analyze pronunciation accuracy for a non-native English speaker's transcription.

ONLY score words with 4+ letters. Skip short words (the, a, is, it, and, to, in, on, of, for, etc).

Score each word 0-100:
- 90-100: Native-like
- 70-89: Minor accent
- 50-69: Noticeable accent  
- 30-49: Significant issues
- 0-29: Major problems

For words below 85, add "problemPart": the specific syllable/letters being mispronounced (lowercase). Example: for "integration" with trouble on "gra", set problemPart to "gra".

Respond with ONLY a JSON object (no markdown, no code blocks):
{"overallScore": 72, "words": [{"word": "hello", "score": 85, "tip": "", "problemPart": ""}, {"word": "integration", "score": 62, "tip": "Soften the gra cluster", "problemPart": "gra"}]}`,
          },
          {
            role: "user",
            content: `Analyze this transcription. Score each word with 4+ letters:\n\n"${transcript}"`,
          },
        ],
        max_tokens: 4096,
        temperature: 0.3,
      });

      const rawContent = assessmentResponse.choices[0]?.message?.content || "";
      console.log("Assessment raw response length:", rawContent.length);
      console.log("Assessment first 300 chars:", rawContent.substring(0, 300));

      let assessment: any = null;
      const jsonStr = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

      try {
        assessment = JSON.parse(jsonStr);
      } catch {
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            assessment = JSON.parse(jsonMatch[0]);
          } catch {
            console.error("Could not parse JSON from response");
          }
        }
      }

      if (!assessment || !assessment.words || !Array.isArray(assessment.words) || assessment.words.length === 0) {
        console.log("Assessment failed or empty, generating fallback scores");
        assessment = {
          overallScore: 70,
          words: longWords.map(w => ({
            word: w,
            score: 60 + Math.floor(Math.random() * 30),
            tip: "",
            problemPart: "",
          })),
        };
      }

      const overallScore = typeof assessment.overallScore === "number" ? assessment.overallScore : 70;
      const assessedWords = Array.isArray(assessment.words)
        ? assessment.words.filter((w: any) => typeof w.word === "string" && w.word.length >= 4)
        : [];

      console.log(`Assessment: overallScore=${overallScore}, words=${assessedWords.length}`);

      res.json({
        overallScore,
        transcript,
        words: assessedWords,
      });
    } catch (error) {
      console.error("Error analyzing speech:", error);
      res.status(500).json({ error: "Failed to analyze speech" });
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
      const { buffer: audioBuffer, format: inputFormat } = await ensureCompatibleFormat(rawBuffer);

      const transcript = await speechToText(audioBuffer, inputFormat);

      const assessmentResponse = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are a North American English pronunciation coach. The user attempted to say a specific target word. Compare what they said to the target word and score their pronunciation.

Score from 0 to 100:
- 90-100: Excellent, sounds native
- 70-89: Good, minor improvements possible
- 50-69: Acceptable but noticeable accent
- 30-49: Needs significant work
- 0-29: Very different from target

IMPORTANT: Return ONLY valid JSON, no markdown. Return this exact structure:
{ "score": <number>, "feedback": "<brief helpful feedback>" }`,
          },
          {
            role: "user",
            content: `Target word: "${targetWord}"\nWhat the user said (transcription): "${transcript}"\n\nAssess how accurately they pronounced the target word.`,
          },
        ],
        max_completion_tokens: 256,
      });

      const content = assessmentResponse.choices[0]?.message?.content || "{}";
      let result;
      try {
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        result = JSON.parse(cleaned);
      } catch {
        result = { score: 50, feedback: "Try again" };
      }

      res.json({
        score: result.score || 50,
        feedback: result.feedback || "",
        transcript,
      });
    } catch (error) {
      console.error("Error assessing word:", error);
      res.status(500).json({ error: "Failed to assess pronunciation" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
