// ─── SSE Event Types ────────────────────────────────────────────────────────
//
// Typed events sent over Server-Sent Events from the agent to the browser.
// Each event type maps to a distinct UI treatment in the client.

export type { Message, ToolCall, ToolDefinition } from "../shared/types.js";

// ─── Stream Metrics ──────────────────────────────────────────────────────────

export interface StreamMetrics {
  /** Time to first token (ms) — how long the user stares at a blank screen */
  ttftMs: number;
  /** Total wall-clock duration (ms) */
  totalDurationMs: number;
  /** Approximate tokens generated */
  tokenCount: number;
  /** Tokens per second */
  tokensPerSecond: number;
  /** Number of tool calls made */
  toolCallCount: number;
  /** Number of ReAct loop iterations */
  iterationCount: number;
}

// ─── SSE Event Discriminated Union ───────────────────────────────────────────

export interface TextEvent {
  type: "text";
  content: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  name: string;
  arguments: Record<string, string>;
}

export interface ToolResultEvent {
  type: "tool_result";
  name: string;
  result: string;
  durationMs: number;
}

export interface DoneEvent {
  type: "done";
  metrics: StreamMetrics;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type SSEEvent = TextEvent | ToolCallEvent | ToolResultEvent | DoneEvent | ErrorEvent;
