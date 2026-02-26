// ─── Re-exports from shared types ────────────────────────────────────────────

export type { Message, ToolDefinition, ToolCall } from "../shared/types.js";

// ─── RAG-Specific Types ─────────────────────────────────────────────────────

export interface KBDocument {
  id: string;
  title: string;
  content: string;
}

export interface Chunk {
  id: string;
  source: string; // document id
  heading: string; // section heading or document title
  content: string;
  embedding?: number[];
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

export type SearchMode = "keyword" | "semantic" | "hybrid";
