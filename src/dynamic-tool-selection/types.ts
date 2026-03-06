import type { ToolDefinition } from "../shared/types.js";

// ─── Tool with Embedding ─────────────────────────────────────────────────────

export interface EmbeddedTool {
  tool: ToolDefinition;
  description: string; // concatenated name + description for embedding
  embedding?: number[];
}

// ─── Selection Strategy ──────────────────────────────────────────────────────

export type SelectionStrategy = "all" | "embedding" | "llm";

// ─── Selection Result ────────────────────────────────────────────────────────

export interface SelectionResult {
  selectedTools: ToolDefinition[];
  totalTools: number;
  strategy: SelectionStrategy;
  selectionTimeMs: number;
  tokenEstimate: number; // rough estimate of tokens consumed by tool definitions
}
