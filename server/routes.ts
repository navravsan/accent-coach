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

      const assessmentResponse = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert speech-language pathologist specializing in North American English accent training for non-native speakers. You will be given a transcription of someone speaking English. Your job is to analyze the transcription and estimate pronunciation accuracy for each word.

Score each word from 0 to 100:
- 90-100: Native-like pronunciation (clear, natural)
- 70-89: Good pronunciation with minor accent
- 50-69: Noticeable accent, could improve
- 30-49: Significant pronunciation issues
- 0-29: Major pronunciation problems

Be realistic and varied in your scoring. Common short words (the, a, is, it) should generally score higher (80-100). Longer or more complex words should have more varied scores. Give actionable tips for words scoring below 80.

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no code blocks. Return this exact JSON structure:
{
  "overallScore": <number 0-100>,
  "words": [
    { "word": "<word>", "score": <number 0-100>, "tip": "<brief pronunciation tip or empty string>" }
  ]
}`,
          },
          {
            role: "user",
            content: `Analyze the pronunciation accuracy of this transcription from a non-native English speaker:\n\n"${transcript}"`,
          },
        ],
        max_completion_tokens: 4096,
      });

      const content = assessmentResponse.choices[0]?.message?.content || "{}";

      let assessment;
      try {
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        assessment = JSON.parse(cleaned);
      } catch {
        assessment = { overallScore: 75, words: [] };
      }

      res.json({
        overallScore: assessment.overallScore || 0,
        transcript,
        words: assessment.words || [],
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
