import type { Message } from "../shared/types.js";

// ─── Token Estimation ────────────────────────────────────────────────────────
//
// Approximates token count using the chars/4 heuristic.
// Good enough for threshold checks in an agent loop.

const CHARS_PER_TOKEN = 4;
const OVERHEAD_PER_MESSAGE = 4; // role label, delimiters, structure

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content) + OVERHEAD_PER_MESSAGE;
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function.name);
        total += estimateTokens(JSON.stringify(tc.function.arguments));
        total += OVERHEAD_PER_MESSAGE;
      }
    }
  }
  return total;
}

export function formatTokenCount(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}
