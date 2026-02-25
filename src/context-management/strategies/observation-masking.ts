import type { ContextStrategy } from "./types.js";
import type { Message } from "../../shared/types.js";
import { estimateMessageTokens } from "../token-counter.js";

// ─── Observation Masking Strategy ────────────────────────────────────────────
//
// The "surprising" strategy from JetBrains/NeurIPS 2025 research.
// Keep ALL assistant messages (reasoning chain) and ALL user messages intact.
// For tool results: keep the N most recent verbatim, replace older ones
// with a short placeholder.
//
// Why it works: Agent reasoning (thoughts, decisions) is compact and valuable.
// Tool outputs (file contents, API responses, search results) are bulky.
// Masking the bulky parts preserves the reasoning chain while dramatically
// reducing tokens.
//
// Research results (Lindenbauer et al., "The Complexity Trap"):
//   - Outperformed LLM summarization in 4/5 settings
//   - 52% cheaper than unmanaged baselines
//   - +2.6% higher solve rate (with Qwen3-Coder 480B)
//   - Zero LLM calls, zero latency overhead
//
// Best for: Agentic loops with tool-heavy work (code, search, data retrieval).

const MASKED_CONTENT = "[Previous tool result cleared — see agent reasoning above for findings]";

export function createObservationMaskingStrategy(observationWindow: number): ContextStrategy {
  return {
    name: "observation-masking",
    description: `Keep last ${observationWindow} tool results verbatim, mask older ones`,

    async prepare(messages: Message[], tokenBudget: number): Promise<Message[]> {
      // If within budget, no management needed
      if (estimateMessageTokens(messages) <= tokenBudget) {
        return messages;
      }

      // Find all tool result message indices
      const toolIndices: number[] = [];
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === "tool") {
          toolIndices.push(i);
        }
      }

      // Nothing to mask
      if (toolIndices.length <= observationWindow) {
        return messages;
      }

      // Mask older tool results, keep the most recent N verbatim
      const indicesToMask = new Set(toolIndices.slice(0, -observationWindow));

      const result = messages.map((msg, i) => {
        if (indicesToMask.has(i)) {
          return { ...msg, content: MASKED_CONTENT };
        }
        return msg;
      });

      return result;
    },
  };
}
