import { z } from "zod";

// ─── Re-exports ──────────────────────────────────────────────────────────────

export type { Message, ToolCall, ToolDefinition } from "../shared/types.js";

// ─── Conversation Metadata Schema ────────────────────────────────────────────
//
// Same schema as post-conversation-metadata — thread title, follow-up
// suggestions, category, and security flag. The difference is *how* it's
// generated: inline via sentinel tags instead of a separate LLM call.

const SuggestionSchema = z.object({
  label: z.string().min(1).describe("Short button label (2-6 words)"),
  prompt: z.string().min(1).describe("Full prompt text the user would send"),
});

export const ConversationMetadataSchema = z.object({
  threadName: z
    .string()
    .min(1)
    .max(60)
    .describe("Short conversation title (2-8 words), like a chat thread name"),
  suggestions: z
    .array(SuggestionSchema)
    .min(1)
    .max(3)
    .describe("1-3 follow-up suggestions the user might want to ask next"),
  category: z
    .enum(["billing", "technical", "feature-request", "account", "general"])
    .describe("Primary category of the user's request"),
  securityFlag: z
    .enum(["none", "pii-detected", "prompt-injection", "suspicious"])
    .describe("Security classification of the conversation"),
});

export type ConversationMetadata = z.infer<typeof ConversationMetadataSchema>;

// Derived once at module load — reused for the separate-call mode's format constraint
export const METADATA_JSON_SCHEMA = z.toJSONSchema(ConversationMetadataSchema);

// ─── Stream Metrics ──────────────────────────────────────────────────────────

export interface StreamMetrics {
  /** Time to first token (ms) */
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
  /** Latency of the metadata extraction (ms) — 0 for sentinel mode */
  metadataLatencyMs: number;
  /** Whether the sentinel tag was detected in the stream */
  sentinelDetected: boolean;
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

export interface MetadataEvent {
  type: "metadata";
  metadata: ConversationMetadata;
}

export interface DoneEvent {
  type: "done";
  metrics: StreamMetrics;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type SSEEvent =
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | MetadataEvent
  | DoneEvent
  | ErrorEvent;
