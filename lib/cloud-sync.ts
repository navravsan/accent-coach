import { getApiUrl } from "@/lib/query-client";
import { getMispronouncedWords, getSessions } from "@/lib/accent-storage";

async function authFetch(path: string, token: string, options: RequestInit = {}) {
  const baseUrl = getApiUrl();
  const url = new URL(path, baseUrl);
  return globalThis.fetch(url.toString(), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

export async function syncLocalDataToCloud(token: string): Promise<void> {
  try {
    const [words, sessions] = await Promise.all([
      getMispronouncedWords(),
      getSessions(),
    ]);

    if (words.length > 0) {
      await authFetch("/api/user/words", token, {
        method: "POST",
        body: JSON.stringify({ words }),
      });
    }

    if (sessions.length > 0) {
      await authFetch("/api/user/sessions", token, {
        method: "POST",
        body: JSON.stringify({ sessions }),
      });
    }
  } catch (err) {
    console.error("Cloud sync error:", err);
  }
}

export async function saveSessionToCloud(
  token: string,
  session: { id: string; date: number; overallScore: number; wordCount: number }
): Promise<void> {
  try {
    await authFetch("/api/user/sessions", token, {
      method: "POST",
      body: JSON.stringify({ sessions: [session] }),
    });
  } catch (err) {
    console.error("Save session error:", err);
  }
}

export async function saveWordsToCloud(
  token: string,
  words: { word: string; scores: number[]; lastSeen: number; tips: string[]; problemPart?: string; phonetic?: string }[]
): Promise<void> {
  try {
    await authFetch("/api/user/words", token, {
      method: "POST",
      body: JSON.stringify({ words }),
    });
  } catch (err) {
    console.error("Save words error:", err);
  }
}

export async function getCloudSessions(token: string) {
  try {
    const res = await authFetch("/api/user/sessions", token);
    if (!res.ok) return [];
    const data = await res.json();
    return data.sessions || [];
  } catch {
    return [];
  }
}
