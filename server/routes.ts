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

      const assessmentResponse = await openai.chat.completions.create({
        model: "gpt-5-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an expert speech-language pathologist specializing in North American English accent training. Analyze a transcription and score each word's pronunciation accuracy.

Scoring guide (0-100):
90-100: Native-like
70-89: Good, minor accent
50-69: Noticeable accent
30-49: Significant issues
0-29: Major problems

Rules:
- Score EVERY word in the transcription
- Common short words (the, a, is, it, and, to) score 80-95
- Longer/complex words get varied scores
- Give a brief tip for any word below 80

You MUST return a JSON object with this exact structure:
{"overallScore": 72, "words": [{"word": "hello", "score": 85, "tip": ""}, {"word": "world", "score": 62, "tip": "Round your lips more on the 'w' sound"}]}`,
          },
          {
            role: "user",
            content: `Score every word in this transcription:\n\n"${transcript}"`,
          },
        ],
        max_completion_tokens: 8192,
      });

      const content = assessmentResponse.choices[0]?.message?.content || "{}";
      console.log("Assessment raw response length:", content.length);

      let assessment;
      try {
        assessment = JSON.parse(content);
      } catch (parseErr) {
        console.error("Failed to parse assessment JSON:", content.substring(0, 500));
        try {
          const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          assessment = JSON.parse(cleaned);
        } catch {
          assessment = { overallScore: 65, words: words.map(w => ({ word: w, score: 70, tip: "" })) };
        }
      }

      const overallScore = typeof assessment.overallScore === "number" ? assessment.overallScore : 65;
      const assessedWords = Array.isArray(assessment.words) ? assessment.words : [];

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
