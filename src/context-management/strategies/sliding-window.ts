import type { ContextStrategy } from "./types.js";
import type { Message } from "../../shared/types.js";
import { estimateMessageTokens } from "../token-counter.js";

// ─── Sliding Window Strategy ─────────────────────────────────────────────────
//
// The simplest context management strategy. Keep only the most recent messages
// that fit within the token budget. Everything else is dropped.
//
// Pros: Zero cost, zero latency, bounded token usage, completely predictable.
// Cons: Total amnesia beyond the window — the agent forgets earlier decisions.
//
// Best for: Short task conversations where older context genuinely doesn't matter.

export function createSlidingWindowStrategy(): ContextStrategy {
  return {
    name: "sliding-window",
    description: "Keep the most recent messages that fit within the token budget",

    async prepare(messages: Message[], tokenBudget: number): Promise<Message[]> {
      // If we're already within budget, no management needed
      if (estimateMessageTokens(messages) <= tokenBudget) {
        return messages;
      }

      // Always keep the first message if it's from the user (often sets context)
      const first = messages[0];
      const keepFirst = first && first.role === "user";
      const firstTokens = keepFirst ? estimateMessageTokens([first]) : 0;
      const remainingBudget = tokenBudget - firstTokens;

      // Walk backwards from the end, adding messages until we hit the budget
      const recent: Message[] = [];
      let usedTokens = 0;

      for (let i = messages.length - 1; i >= (keepFirst ? 1 : 0); i--) {
        const msgTokens = estimateMessageTokens([messages[i]]);
        if (usedTokens + msgTokens > remainingBudget) break;
        recent.unshift(messages[i]);
        usedTokens += msgTokens;
      }

      return keepFirst ? [first, ...recent] : recent;
    },
  };
}
