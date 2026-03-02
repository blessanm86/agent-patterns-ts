// ─── Eval: Agentic RAG vs Basic RAG (Head-to-Head) ──────────────────────────
//
// Complex questions requiring cross-document reasoning. Basic RAG gets partial
// answers because it searches once; agentic RAG iterates to cover more ground.
// Scorers: LLM-as-judge for completeness + deterministic check that agentic
// mode made >1 search call.

import "dotenv/config";
import { evalite, createScorer } from "evalite";
import ollama from "ollama";
import { documents } from "../knowledge-base.js";
import { chunkDocuments } from "../chunker.js";
import { embedChunks } from "../vector-store.js";
import { configure } from "../tools.js";
import { runBasicAgent, runAgenticAgent } from "../agent.js";
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

function completenessJudgePrompt(
  question: string,
  answer: string,
  requiredTopics: string[],
): string {
  return `You are evaluating a documentation assistant's answer about NexusDB.

The user asked: "${question}"

The answer must cover ALL of these topics to be complete:
${requiredTopics.map((t) => `- ${t}`).join("\n")}

The assistant answered:
"""
${answer}
"""

Score the response from 0.0 to 1.0:
- 1.0 = Covers ALL required topics with specific details from documentation
- 0.5 = Covers SOME topics but misses others
- 0.0 = Barely covers any of the required topics

Respond with JSON only:
{ "score": <number 0.0-1.0>, "reason": "<one sentence>" }`;
}

// ─── Scorers ────────────────────────────────────────────────────────────────

function makeCompletenessJudge(name: string) {
  return createScorer<
    string,
    { basic: string; agentic: string; agenticStats: AgentResult["stats"] }
  >({
    name,
    scorer: async ({ input, output }) => {
      // Parse the expected topics from the input (embedded in test data)
      const topicMap: Record<string, string[]> = {
        "How do I set up replication and configure automated backups?": [
          "replication modes (leader-follower, multi-leader)",
          "replication configuration",
          "backup types (snapshot, incremental)",
          "automated backup schedule configuration",
        ],
        "My NexusDB is running out of memory and queries are slow, how do I fix it?": [
          "memory management (cache_size_mb, memory_limit_mb)",
          "max_connections tuning",
          "slow query diagnosis (EXPLAIN, indexes)",
          "compaction",
        ],
        "What's the complete security setup for a zero-trust production environment?": [
          "authentication methods (API key, password, mTLS)",
          "RBAC roles",
          "encryption at rest",
          "TLS for connections",
        ],
      };

      const topics = topicMap[input] ?? ["relevant documentation details"];

      try {
        const result = await ollama.chat({
          model: MODEL,
          messages: [
            { role: "user", content: completenessJudgePrompt(input, output.agentic, topics) },
          ],
          format: "json",
        });
        const parsed = JSON.parse(result.message.content) as { score: number; reason: string };
        return Math.max(0, Math.min(1, parsed.score));
      } catch {
        return 0;
      }
    },
  });
}

// ─── Eval ───────────────────────────────────────────────────────────────────

evalite("Agentic RAG vs Basic RAG — complex cross-document questions", {
  data: async () => [
    { input: "How do I set up replication and configure automated backups?" },
    { input: "My NexusDB is running out of memory and queries are slow, how do I fix it?" },
    { input: "What's the complete security setup for a zero-trust production environment?" },
  ],
  task: async (input) => {
    await ensureInitialized();
    const basicResult = await runBasicAgent(input, []);
    const agenticResult = await runAgenticAgent(input, []);
    return {
      basic: lastAssistantText(basicResult.messages),
      agentic: lastAssistantText(agenticResult.messages),
      agenticStats: agenticResult.stats,
    };
  },
  scorers: [
    makeCompletenessJudge("Agentic answer completeness"),
    createScorer<string, { basic: string; agentic: string; agenticStats: AgentResult["stats"] }>({
      name: "Agentic used multiple searches",
      scorer: ({ output }) => (output.agenticStats.searchCalls > 1 ? 1 : 0),
    }),
  ],
});
