import { Buffer } from "node:buffer";

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY || "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || "";

export interface AzureWordResult {
  word: string;
  accuracyScore: number;
  errorType: string;
  phonemes?: Array<{
    phoneme: string;
    accuracyScore: number;
  }>;
}

export interface AzurePronunciationResult {
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronScore: number;
  prosodyScore?: number;
  words: AzureWordResult[];
  recognizedText: string;
}

export async function assessPronunciation(
  wavBuffer: Buffer,
  referenceText: string
): Promise<AzurePronunciationResult> {
  if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
    throw new Error("Azure Speech credentials not configured");
  }

  const pronConfig = {
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableProsodyAssessment: "True",
  };

  const pronHeader = Buffer.from(JSON.stringify(pronConfig)).toString("base64");

  const url = `https://${AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      "Accept": "application/json;text/xml",
      "Pronunciation-Assessment": pronHeader,
    },
    body: new Uint8Array(wavBuffer),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Azure Speech API error:", response.status, errorText);
    throw new Error(`Azure Speech API error: ${response.status} - ${errorText}`);
  }

  const data: any = await response.json();
  console.log("Azure response status:", data.RecognitionStatus);

  if (data.RecognitionStatus !== "Success") {
    return {
      accuracyScore: 0,
      fluencyScore: 0,
      completenessScore: 0,
      pronScore: 0,
      words: [],
      recognizedText: "",
    };
  }

  const nbest = data.NBest?.[0];
  if (!nbest) {
    return {
      accuracyScore: 0,
      fluencyScore: 0,
      completenessScore: 0,
      pronScore: 0,
      words: [],
      recognizedText: data.DisplayText || "",
    };
  }

  const words: AzureWordResult[] = (nbest.Words || []).map((w: any) => ({
    word: w.Word,
    accuracyScore: w.PronunciationAssessment?.AccuracyScore ?? w.AccuracyScore ?? 0,
    errorType: w.PronunciationAssessment?.ErrorType ?? w.ErrorType ?? "None",
    phonemes: w.Phonemes?.map((p: any) => ({
      phoneme: p.Phoneme,
      accuracyScore: p.PronunciationAssessment?.AccuracyScore ?? 0,
    })),
  }));

  const pa = nbest.PronunciationAssessment || nbest;

  return {
    accuracyScore: pa.AccuracyScore ?? 0,
    fluencyScore: pa.FluencyScore ?? 0,
    completenessScore: pa.CompletenessScore ?? 0,
    pronScore: pa.PronScore ?? 0,
    prosodyScore: pa.ProsodyScore,
    words,
    recognizedText: nbest.Display || nbest.Lexical || data.DisplayText || "",
  };
}

export async function assessWord(
  wavBuffer: Buffer,
  targetWord: string
): Promise<{ score: number; errorType: string; phonemes?: Array<{ phoneme: string; score: number }> }> {
  const result = await assessPronunciation(wavBuffer, targetWord);

  const matchedWord = result.words.find(
    (w) => w.word.toLowerCase() === targetWord.toLowerCase()
  ) || result.words[0];

  if (!matchedWord) {
    return { score: 0, errorType: "Omission" };
  }

  return {
    score: matchedWord.accuracyScore,
    errorType: matchedWord.errorType,
    phonemes: matchedWord.phonemes?.map((p) => ({
      phoneme: p.phoneme,
      score: p.accuracyScore,
    })),
  };
}
