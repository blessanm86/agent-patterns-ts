import crypto from "node:crypto";
import type { Thread, Turn, Item } from "./types.js";

// ─── Thread Store ────────────────────────────────────────────────────────────
//
// In-memory thread persistence. Threads survive across turns within a single
// server process. A real production system would back this with a database,
// but the in-memory version teaches the same API surface.

const threads = new Map<string, Thread>();

export function createThread(title?: string): Thread {
  const id = `thread-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  const thread: Thread = {
    id,
    title: title ?? "New conversation",
    history: [],
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
  threads.set(id, thread);
  return thread;
}

export function getThread(id: string): Thread | undefined {
  return threads.get(id);
}

export function listThreads(): Thread[] {
  return Array.from(threads.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveThread(thread: Thread): void {
  thread.updatedAt = Date.now();
  threads.set(thread.id, thread);
}

// ─── Turn + Item Helpers ─────────────────────────────────────────────────────

export function createTurn(threadId: string): Turn {
  const id = `turn-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    threadId,
    status: "in_progress",
    items: [],
    createdAt: Date.now(),
  };
}

export function addItemToTurn(turn: Turn, item: Item): void {
  const existing = turn.items.findIndex((i) => i.id === item.id);
  if (existing !== -1) {
    turn.items[existing] = item;
  } else {
    turn.items.push(item);
  }
}

// ─── Thread Summary (for listing) ────────────────────────────────────────────

export interface ThreadSummary {
  id: string;
  title: string;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
}

export function getThreadSummaries(): ThreadSummary[] {
  return listThreads().map((t) => ({
    id: t.id,
    title: t.title,
    turnCount: t.turns.length,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
}
