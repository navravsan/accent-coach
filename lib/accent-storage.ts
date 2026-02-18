import AsyncStorage from "@react-native-async-storage/async-storage";

export interface MispronouncedWord {
  word: string;
  scores: number[];
  lastSeen: number;
  tips: string[];
  problemPart?: string;
  phonetic?: string;
  userAudio?: string;
}

const STORAGE_KEY = "accent_mispronounced_words";
const SESSIONS_KEY = "accent_sessions";

export interface SessionRecord {
  id: string;
  date: number;
  overallScore: number;
  wordCount: number;
}

export async function getMispronouncedWords(): Promise<MispronouncedWord[]> {
  const data = await AsyncStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  return JSON.parse(data);
}

export async function saveMispronouncedWords(words: MispronouncedWord[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

export async function addMispronouncedWords(
  newWords: { word: string; score: number; tip: string; problemPart?: string; phonetic?: string; userAudio?: string }[]
): Promise<void> {
  const existing = await getMispronouncedWords();
  const wordMap = new Map<string, MispronouncedWord>();

  for (const w of existing) {
    wordMap.set(w.word.toLowerCase(), w);
  }

  for (const nw of newWords) {
    if (nw.score >= 85) continue;
    if (nw.word.length < 4) continue;
    const key = nw.word.toLowerCase();
    const current = wordMap.get(key);
    if (current) {
      current.scores.push(nw.score);
      current.lastSeen = Date.now();
      if (nw.tip && !current.tips.includes(nw.tip)) {
        current.tips.push(nw.tip);
      }
      if (nw.problemPart) current.problemPart = nw.problemPart;
      if (nw.phonetic) current.phonetic = nw.phonetic;
      if (nw.userAudio) current.userAudio = nw.userAudio;
    } else {
      wordMap.set(key, {
        word: nw.word,
        scores: [nw.score],
        lastSeen: Date.now(),
        tips: nw.tip ? [nw.tip] : [],
        problemPart: nw.problemPart || "",
        phonetic: nw.phonetic || "",
        userAudio: nw.userAudio,
      });
    }
  }

  await saveMispronouncedWords(Array.from(wordMap.values()));
}

export async function updateWordScore(word: string, newScore: number): Promise<void> {
  const words = await getMispronouncedWords();
  const key = word.toLowerCase();
  const found = words.find((w) => w.word.toLowerCase() === key);
  if (found) {
    found.scores.push(newScore);
    found.lastSeen = Date.now();
    if (newScore >= 90) {
      found.scores = found.scores.slice(-3);
    }
    await saveMispronouncedWords(words);
  }
}

export function getTopPracticeWords(words: MispronouncedWord[], count: number = 10): MispronouncedWord[] {
  const scored = words.map((w) => {
    const avgScore = w.scores.reduce((a, b) => a + b, 0) / w.scores.length;
    const frequency = w.scores.length;
    const severity = 100 - avgScore;
    const priority = severity * 0.7 + Math.min(frequency, 10) * 3;
    return { ...w, priority, avgScore };
  });

  scored.sort((a, b) => b.priority - a.priority);
  return scored.slice(0, count);
}

export function getAverageScore(word: MispronouncedWord): number {
  if (word.scores.length === 0) return 0;
  return Math.round(word.scores.reduce((a, b) => a + b, 0) / word.scores.length);
}

export async function getSessions(): Promise<SessionRecord[]> {
  const data = await AsyncStorage.getItem(SESSIONS_KEY);
  if (!data) return [];
  return JSON.parse(data);
}

export async function addSession(session: SessionRecord): Promise<void> {
  const sessions = await getSessions();
  sessions.unshift(session);
  if (sessions.length > 50) sessions.pop();
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export async function removeWord(word: string): Promise<void> {
  const words = await getMispronouncedWords();
  const filtered = words.filter((w) => w.word.toLowerCase() !== word.toLowerCase());
  await saveMispronouncedWords(filtered);
}

export async function clearAllWords(): Promise<void> {
  await saveMispronouncedWords([]);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify([]));
}

export async function clearLastSessionWords(): Promise<void> {
  const sessions = await getSessions();
  if (sessions.length === 0) return;
  const lastSession = sessions[0];
  const words = await getMispronouncedWords();
  const prevSessionDate = sessions.length > 1 ? sessions[1].date : 0;
  const filtered = words.filter((w) => w.lastSeen < prevSessionDate || w.lastSeen > lastSession.date + 10000);
  await saveMispronouncedWords(filtered);
  const remainingSessions = sessions.slice(1);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(remainingSessions));
}
