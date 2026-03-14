import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, jsonb, bigint, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userWords = pgTable("user_words", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  word: text("word").notNull(),
  scores: jsonb("scores").notNull().default(sql`'[]'::jsonb`),
  lastSeen: bigint("last_seen", { mode: "number" }).notNull().default(0),
  tips: jsonb("tips").notNull().default(sql`'[]'::jsonb`),
  problemPart: text("problem_part").default(""),
  phonetic: text("phonetic").default(""),
});

export const userSessions = pgTable("user_sessions", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: bigint("date", { mode: "number" }).notNull(),
  overallScore: integer("overall_score").notNull(),
  wordCount: integer("word_count").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  passwordHash: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UserWord = typeof userWords.$inferSelect;
export type UserSession = typeof userSessions.$inferSelect;
