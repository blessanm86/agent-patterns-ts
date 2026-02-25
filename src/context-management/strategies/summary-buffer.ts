import ollama from "ollama";
import type { ContextStrategy } from "./types.js";
import type { Message } from "../../shared/types.js";
import { estimateMessageTokens } from "../token-counter.js";

// ─── Summary + Buffer Strategy ───────────────────────────────────────────────
//
// The "best of both worlds" approach (LangChain's ConversationSummaryBufferMemory).
// Keep recent messages verbatim (the buffer), summarize older messages into a
// single summary message that replaces them.
//
// Pros: Preserves recent detail AND compressed history. Good information retention.
// Cons: Costs extra tokens (the summarization LLM call). Adds latency.
//       Can introduce hallucinations (the summary is LLM-generated).
//
// Best for: Long conversations where older context still matters.

const MODEL = process.env.MODEL ?? "qwen2.5:7b";

const SUMMARIZE_PROMPT = `Summarize this conversation excerpt concisely. Preserve:
- Key facts and data discovered
- User preferences and requirements stated
- Decisions made and their reasoning
- Unresolved questions or pending tasks

Be concise but don't lose important details. Write in third person ("The user asked about...", "The assistant found that...").`;

export function createSummaryBufferStrategy(bufferSize: number): ContextStrategy {
  return {
    name: "summary-buffer",
    description: `Summarize older messages, keep last ${bufferSize} verbatim`,

    async prepare(messages: Message[], tokenBudget: number): Promise<Message[]> {
      // If within budget, no management needed
      if (estimateMessageTokens(messages) <= tokenBudget) {
        return messages;
      }

      // Split: older messages to summarize, recent messages to keep verbatim
      const bufferStart = Math.max(0, messages.length - bufferSize);
      const olderMessages = messages.slice(0, bufferStart);
      const recentMessages = messages.slice(bufferStart);

      // Nothing to summarize
      if (olderMessages.length === 0) {
        return recentMessages;
      }

      // Build the text to summarize
      const conversationText = olderMessages
        .map((m) => {
          const role = m.role === "tool" ? "Tool result" : m.role;
          return `${role}: ${m.content}`;
        })
        .join("\n\n");

      // Call the LLM to summarize
      const summaryResponse = await ollama.chat({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: `${SUMMARIZE_PROMPT}\n\n---\n\n${conversationText}`,
          },
        ],
      });

      const summaryMessage: Message = {
        role: "user",
        content: `[Summary of earlier conversation]:\n${summaryResponse.message.content}`,
      };

      // Check if the result fits in budget; if not, just return recent messages
      const result = [summaryMessage, ...recentMessages];
      if (estimateMessageTokens(result) > tokenBudget) {
        return recentMessages;
      }

      return result;
    },
  };
}
