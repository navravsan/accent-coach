import type { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { users, userWords, userSessions } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback_dev_secret";
const SALT_ROUNDS = 10;

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const [user] = await db.insert(users).values({
        email: email.toLowerCase(),
        passwordHash,
      }).returning();

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "90d" });
      return res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
      console.error("Register error:", err);
      return res.status(500).json({ error: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "90d" });
      return res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
      console.error("Login error:", err);
      return res.status(500).json({ error: "Failed to log in" });
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req: AuthRequest, res: Response) => {
    return res.json({ user: req.user });
  });

  app.get("/api/user/words", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const words = await db.select().from(userWords).where(eq(userWords.userId, req.user!.id));
      return res.json({ words });
    } catch (err) {
      console.error("Get words error:", err);
      return res.status(500).json({ error: "Failed to get words" });
    }
  });

  app.post("/api/user/words", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { words } = req.body;
      if (!Array.isArray(words)) {
        return res.status(400).json({ error: "Words must be an array" });
      }

      const userId = req.user!.id;
      const existing = await db.select().from(userWords).where(eq(userWords.userId, userId));
      const existingMap = new Map(existing.map(w => [w.word.toLowerCase(), w]));

      for (const w of words) {
        const key = w.word.toLowerCase();
        const existing = existingMap.get(key);
        if (existing) {
          await db.update(userWords)
            .set({
              scores: w.scores,
              lastSeen: w.lastSeen,
              tips: w.tips,
              problemPart: w.problemPart || "",
              phonetic: w.phonetic || "",
            })
            .where(and(eq(userWords.userId, userId), eq(userWords.word, key)));
        } else {
          await db.insert(userWords).values({
            userId,
            word: key,
            scores: w.scores,
            lastSeen: w.lastSeen,
            tips: w.tips,
            problemPart: w.problemPart || "",
            phonetic: w.phonetic || "",
          });
        }
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("Save words error:", err);
      return res.status(500).json({ error: "Failed to save words" });
    }
  });

  app.get("/api/user/sessions", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const sessions = await db.select().from(userSessions)
        .where(eq(userSessions.userId, req.user!.id))
        .orderBy(userSessions.date);
      return res.json({ sessions });
    } catch (err) {
      console.error("Get sessions error:", err);
      return res.status(500).json({ error: "Failed to get sessions" });
    }
  });

  app.post("/api/user/sessions", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { sessions } = req.body;
      if (!Array.isArray(sessions)) {
        return res.status(400).json({ error: "Sessions must be an array" });
      }

      const userId = req.user!.id;
      for (const s of sessions) {
        await db.insert(userSessions)
          .values({ id: s.id, userId, date: s.date, overallScore: s.overallScore, wordCount: s.wordCount })
          .onConflictDoNothing();
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("Save sessions error:", err);
      return res.status(500).json({ error: "Failed to save sessions" });
    }
  });
}
