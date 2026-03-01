// ─── Persistent Memory Store ────────────────────────────────────────────────
//
// JSON-file-backed memory store inspired by Generative Agents (Park et al.)
// scoring but simplified for a single-user CLI agent. Stores MemoryFact
// records, scores them for relevance, and injects the top N into the system
// prompt at session start.
//
// Scoring formula (simplified Generative Agents):
//   score = 0.4 × (importance/10)
//         + 0.4 × (0.995^hoursSinceAccess)      ← recency decay
//         + 0.2 × (log(1 + accessCount) / 10)   ← frequency bonus

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MemoryCategory =
  | "dietary"
  | "cuisine"
  | "restaurant"
  | "location"
  | "dining-style"
  | "personal";

export interface MemoryFact {
  id: string;
  content: string;
  category: MemoryCategory;
  importance: number; // 1-10, LLM-rated
  source: "extracted" | "explicit";
  createdAt: string; // ISO 8601
  lastAccessedAt: string;
  accessCount: number;
  sessionId: number;
}

interface MemoryStoreData {
  currentSession: number;
  facts: MemoryFact[];
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class PersistentMemoryStore {
  private filePath: string;
  private data: MemoryStoreData;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load(): MemoryStoreData {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as MemoryStoreData;
    } catch {
      return { currentSession: 1, facts: [] };
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  // ── Session Management ───────────────────────────────────────────────────

  get currentSession(): number {
    return this.data.currentSession;
  }

  nextSession(): number {
    this.data.currentSession += 1;
    this.save();
    return this.data.currentSession;
  }

  // ── Scoring ──────────────────────────────────────────────────────────────

  private scoreFact(fact: MemoryFact): number {
    const hoursSinceAccess =
      (Date.now() - new Date(fact.lastAccessedAt).getTime()) / (1000 * 60 * 60);

    const importanceScore = 0.4 * (fact.importance / 10);
    const recencyScore = 0.4 * Math.pow(0.995, hoursSinceAccess);
    const frequencyScore = 0.2 * (Math.log(1 + fact.accessCount) / 10);

    return importanceScore + recencyScore + frequencyScore;
  }

  // ── Retrieval ────────────────────────────────────────────────────────────

  getRelevantMemories(limit: number = 15): MemoryFact[] {
    if (this.data.facts.length === 0) return [];

    const scored = this.data.facts.map((fact) => ({
      fact,
      score: this.scoreFact(fact),
    }));

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    // Update access metadata for injected facts
    const now = new Date().toISOString();
    for (const { fact } of top) {
      fact.lastAccessedAt = now;
      fact.accessCount += 1;
    }
    this.save();

    return top.map((s) => s.fact);
  }

  toPromptString(): string {
    const facts = this.getRelevantMemories();
    if (facts.length === 0) return "";

    const lines = facts.map(
      (f) => `- ${f.content} (importance: ${f.importance}, session ${f.sessionId})`,
    );
    return `## What I Remember About You\n${lines.join("\n")}`;
  }

  // ── Storage ──────────────────────────────────────────────────────────────

  addFact(content: string, category: MemoryCategory, importance: number): MemoryFact {
    const now = new Date().toISOString();
    const fact: MemoryFact = {
      id: `mem-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      content,
      category,
      importance,
      source: "extracted",
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      sessionId: this.data.currentSession,
    };
    this.data.facts.push(fact);
    this.save();
    return fact;
  }

  // ── Deduplication ────────────────────────────────────────────────────────

  deduplicate(content: string, category: MemoryCategory): MemoryFact | null {
    const contentLower = content.toLowerCase();
    const sameCategoryFacts = this.data.facts.filter((f) => f.category === category);

    for (const existing of sameCategoryFacts) {
      const existingLower = existing.content.toLowerCase();
      if (existingLower.includes(contentLower) || contentLower.includes(existingLower)) {
        return existing;
      }
    }
    return null;
  }

  // ── Forget ───────────────────────────────────────────────────────────────

  forgetByContent(text: string): MemoryFact[] {
    const textLower = text.toLowerCase();
    const removed: MemoryFact[] = [];
    this.data.facts = this.data.facts.filter((f) => {
      if (f.content.toLowerCase().includes(textLower)) {
        removed.push(f);
        return false;
      }
      return true;
    });
    if (removed.length > 0) this.save();
    return removed;
  }

  clearAll(): number {
    const count = this.data.facts.length;
    this.data.facts = [];
    this.data.currentSession = 1;
    this.save();
    return count;
  }

  // ── Display ──────────────────────────────────────────────────────────────

  toDisplayLines(): string[] {
    if (this.data.facts.length === 0) return ["  (no memories stored)"];

    const scored = this.data.facts.map((fact) => ({
      fact,
      score: this.scoreFact(fact),
    }));
    scored.sort((a, b) => b.score - a.score);

    return scored.map(
      ({ fact, score }) =>
        `  [${fact.category}] ${fact.content} (importance: ${fact.importance}, score: ${score.toFixed(3)}, session ${fact.sessionId})`,
    );
  }

  getCategoryStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const fact of this.data.facts) {
      stats[fact.category] = (stats[fact.category] ?? 0) + 1;
    }
    return stats;
  }

  get factCount(): number {
    return this.data.facts.length;
  }

  get allFacts(): MemoryFact[] {
    return [...this.data.facts];
  }
}
