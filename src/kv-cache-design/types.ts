// ─── KV-Cache-Aware Context Design — Types ──────────────────────────────────

import type { Message, ToolDefinition } from "../shared/types.js";

/** Metrics collected per turn from Ollama's response metadata. */
export interface TurnMetrics {
  turn: number;
  question: string;
  promptTokens: number; // prompt_eval_count — drops on cache hit
  promptEvalMs: number; // prompt_eval_duration (converted to ms)
  responseTokens: number; // eval_count
  responseEvalMs: number; // eval_duration (converted to ms)
  totalMs: number; // total_duration (converted to ms)
}

/** Aggregate metrics for a complete strategy run. */
export interface StrategyResult {
  strategy: string;
  turns: TurnMetrics[];
  avgPromptTokens: number;
  avgPromptEvalMs: number;
  // Warm turns (2+) — excludes cold-start first turn
  warmAvgPromptTokens: number;
  warmAvgPromptEvalMs: number;
}

/** Provider cost projection for a given strategy. */
export interface CostProjection {
  provider: string;
  withoutCaching: number;
  withCaching: number;
  savings: number;
  savingsPercent: number;
}

/** A context strategy controls how the prompt is assembled each turn. */
export interface ContextStrategy {
  name: string;
  description: string;

  /** Build the system prompt for this turn. */
  buildSystemPrompt(turn: number): string;

  /** Return the tool definitions for this turn. */
  buildTools(turn: number, allTools: ToolDefinition[]): ToolDefinition[];

  /**
   * Process the message history before sending to the model.
   * Strategies can mutate, compress, or leave history unchanged.
   */
  processHistory(history: Message[], turn: number): Message[];
}

/** Filesystem-offloaded content reference (for cache-optimized strategy). */
export interface OffloadedContent {
  turnIndex: number;
  originalLength: number;
  reference: string; // file path or compact summary
}
