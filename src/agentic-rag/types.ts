// ─── Re-exports from shared types ────────────────────────────────────────────

import type { Message as _Message } from "../shared/types.js";

export type { Message, ToolDefinition, ToolCall } from "../shared/types.js";

// ─── RAG-Specific Types (same as basic RAG) ─────────────────────────────────

export interface KBDocument {
  id: string;
  title: string;
  content: string;
}

export interface Chunk {
  id: string;
  source: string;
  heading: string;
  content: string;
  embedding?: number[];
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

export type SearchMode = "keyword" | "semantic" | "hybrid";

// ─── Agentic RAG Types ──────────────────────────────────────────────────────

export interface AgentStats {
  mode: "basic" | "agentic";
  llmCalls: number;
  searchCalls: number;
  searchBudget: number;
  budgetExhausted: boolean;
}

export interface AgentResult {
  messages: _Message[];
  stats: AgentStats;
}
