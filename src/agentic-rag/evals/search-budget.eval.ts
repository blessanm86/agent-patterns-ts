// ─── Eval: Search Budget Enforcement ────────────────────────────────────────
//
// Gives the agentic agent broad questions that could trigger many searches.
// Verifies that the agent respects the search budget (5) and still produces
// a useful answer even when the budget is exhausted.

import "dotenv/config";
import { evalite, createScorer } from "evalite";
import ollama from "ollama";
import { documents } from "../knowledge-base.js";
import { chunkDocuments } from "../chunker.js";
import { embedChunks } from "../vector-store.js";
import { configure } from "../tools.js";
import { runAgenticAgent } from "../agent.js";
import type { Message, AgentResult } from "../types.js";

const MODEL = process.env.MODEL ?? "qwen2.5:7b";

// ─── Setup ──────────────────────────────────────────────────────────────────

let initialized = false;

async function ensureInitialized() {
  if (initialized) return;
  const chunks = chunkDocuments(documents);
  const embedded = await embedChunks(chunks);
  configure(embedded, "hybrid", documents);
  initialized = true;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function lastAssistantText(messages: Message[]): string {
  const textMessages = messages.filter(
    (m) => m.role === "assistant" && (!m.tool_calls || m.tool_calls.length === 0),
  );
  return textMessages[textMessages.length - 1]?.content ?? "";
}

// ─── Eval ───────────────────────────────────────────────────────────────────

evalite("Agentic RAG — search budget is enforced", {
  data: async () => [
    {
      input:
        "Give me a complete overview of NexusDB: installation, configuration, query syntax, " +
        "indexing, replication, security, API, troubleshooting, migrations, performance tuning, " +
        "backups, and data types.",
    },
    {
      input:
        "I need to set up a production NexusDB deployment from scratch. Cover every aspect: " +
        "hardware requirements, installation, configuration, security, replication, backups, " +
        "performance tuning, and monitoring.",
    },
  ],
  task: async (input) => {
    await ensureInitialized();
    const result = await runAgenticAgent(input, []);
    return {
      answer: lastAssistantText(result.messages),
      stats: result.stats,
    };
  },
  scorers: [
    createScorer<string, { answer: string; stats: AgentResult["stats"] }>({
      name: "Budget not exceeded",
      scorer: ({ output }) => (output.stats.searchCalls <= output.stats.searchBudget ? 1 : 0),
    }),
    createScorer<string, { answer: string; stats: AgentResult["stats"] }>({
      name: "Still produces useful answer",
      scorer: async ({ input, output }) => {
        try {
          const result = await ollama.chat({
            model: MODEL,
            messages: [
              {
                role: "user",
                content: `The user asked: "${input}"

The assistant answered:
"""
${output.answer}
"""

Is this a useful, substantive answer (even if not exhaustive)? Score 0.0 to 1.0:
- 1.0 = Useful answer with real information from documentation
- 0.5 = Partial answer with some useful content
- 0.0 = Empty, error message, or completely unhelpful

Respond with JSON only:
{ "score": <number 0.0-1.0>, "reason": "<one sentence>" }`,
              },
            ],
            format: "json",
          });
          const parsed = JSON.parse(result.message.content) as { score: number; reason: string };
          return Math.max(0, Math.min(1, parsed.score));
        } catch {
          return 0;
        }
      },
    }),
  ],
});
