import type { Message } from "../../shared/types.js";

// ─── Context Strategy Interface ──────────────────────────────────────────────
//
// Every context management strategy implements one function:
// take the current messages + a token budget, return trimmed messages.
//
// The agent loop calls strategy.prepare() before each LLM call.
// This is the entire abstraction — strategies are just message transformers.

export interface ContextStrategy {
  name: string;
  description: string;
  prepare(messages: Message[], tokenBudget: number): Promise<Message[]>;
}

export interface ContextStats {
  tokensBefore: number;
  tokensAfter: number;
  strategyName: string;
  triggered: boolean;
}
