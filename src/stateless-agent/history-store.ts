import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { Message } from "../shared/types.js";

// ─── External History Store ──────────────────────────────────────────────────
//
// Simulates a database (Redis, Postgres, DynamoDB) with a JSON file.
// The canonical conversation history lives HERE — not in any worker.
// Every worker loads from and saves to this store on each turn.

export interface ConversationRecord {
  threadId: string;
  messages: TimestampedMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface TimestampedMessage extends Message {
  timestamp: string;
  workerId?: string;
}

const STORE_DIR = join(process.cwd(), ".tmp");
const STORE_PATH = join(STORE_DIR, "conversation-store.json");

// ─── Store Operations ────────────────────────────────────────────────────────

function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
}

function loadStore(): Map<string, ConversationRecord> {
  ensureStoreDir();
  if (!existsSync(STORE_PATH)) {
    return new Map();
  }
  const raw = readFileSync(STORE_PATH, "utf-8");
  const entries: [string, ConversationRecord][] = JSON.parse(raw);
  return new Map(entries);
}

function saveStore(store: Map<string, ConversationRecord>): void {
  ensureStoreDir();
  writeFileSync(STORE_PATH, JSON.stringify([...store.entries()], null, 2));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getConversation(threadId: string): ConversationRecord | undefined {
  const store = loadStore();
  return store.get(threadId);
}

export function getOrCreateConversation(threadId: string): ConversationRecord {
  const store = loadStore();
  let record = store.get(threadId);
  if (!record) {
    record = {
      threadId,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.set(threadId, record);
    saveStore(store);
  }
  return record;
}

export function appendMessages(
  threadId: string,
  newMessages: TimestampedMessage[],
): ConversationRecord {
  const store = loadStore();
  const record = store.get(threadId) ?? {
    threadId,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  record.messages.push(...newMessages);
  record.updatedAt = new Date().toISOString();
  store.set(threadId, record);
  saveStore(store);
  return record;
}

export function listThreads(): string[] {
  const store = loadStore();
  return [...store.keys()];
}

export function clearStore(): void {
  ensureStoreDir();
  writeFileSync(STORE_PATH, "[]");
}

// ─── History Serialization ───────────────────────────────────────────────────
//
// Converts timestamped messages to plain Message[] for the LLM.
// The LLM never sees timestamps or worker IDs — those are operational metadata.

export function toModelMessages(record: ConversationRecord): Message[] {
  return record.messages.map((m) => {
    const msg: Message = { role: m.role, content: m.content };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    return msg;
  });
}
