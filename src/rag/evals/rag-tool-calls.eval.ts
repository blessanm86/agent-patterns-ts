// ─── Eval: RAG Tool Call Trajectory ──────────────────────────────────────────
//
// Checks that the agent calls search_docs when RAG is enabled.
// This is the most basic RAG eval — if the agent doesn't search,
// it can't ground its answer.

import { evalite, createScorer } from "evalite";
import { runAgent } from "../agent.js";
import type { Message, ToolCall } from "../types.js";

function extractToolCallNames(history: Message[]): string[] {
  return history
    .filter(
      (m): m is Message & { tool_calls: ToolCall[] } =>
        m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    )
    .flatMap((m) => m.tool_calls.map((tc) => tc.function.name));
}

evalite("RAG — agent calls search_docs for factual questions", {
  data: async () => [
    { input: "What port does NexusDB use by default?" },
    { input: "How do I create a backup in NexusDB?" },
    { input: "What query language does NexusDB use?" },
  ],
  task: async (input) => {
    const history = await runAgent(input, [], true);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "search_docs called",
      scorer: ({ output }) => (output.includes("search_docs") ? 1 : 0),
    }),
    createScorer<string, string[]>({
      name: "No unknown tools",
      scorer: ({ output }) => (output.every((t) => t === "search_docs") ? 1 : 0),
    }),
  ],
});
