// ─── Eval: Iterative Retrieval Trajectory ───────────────────────────────────
//
// Verifies that the agentic agent actually iterates — calls search_docs
// multiple times with DIFFERENT queries. This is the core behavior that
// separates agentic RAG from basic RAG.

import "dotenv/config";
import { evalite, createScorer } from "evalite";
import { documents } from "../knowledge-base.js";
import { chunkDocuments } from "../chunker.js";
import { embedChunks } from "../vector-store.js";
import { configure } from "../tools.js";
import { runAgenticAgent } from "../agent.js";
import type { Message, ToolCall } from "../types.js";

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

interface SearchCall {
  name: string;
  query: string;
}

function extractSearchCalls(history: Message[]): SearchCall[] {
  return history
    .filter(
      (m): m is Message & { tool_calls: ToolCall[] } =>
        m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    )
    .flatMap((m) =>
      m.tool_calls
        .filter((tc) => tc.function.name === "search_docs")
        .map((tc) => ({
          name: tc.function.name,
          query: (tc.function.arguments as Record<string, string>).query ?? "",
        })),
    );
}

// ─── Eval ───────────────────────────────────────────────────────────────────

evalite("Agentic RAG — agent iterates with different queries", {
  data: async () => [
    { input: "How do I set up replication and configure automated backups?" },
    { input: "Compare all the index types NexusDB supports and when to use each" },
    { input: "What's the complete security setup for a production deployment?" },
  ],
  task: async (input) => {
    await ensureInitialized();
    const result = await runAgenticAgent(input, []);
    return extractSearchCalls(result.messages);
  },
  scorers: [
    createScorer<string, SearchCall[]>({
      name: "Multiple searches performed",
      scorer: ({ output }) => (output.length > 1 ? 1 : 0),
    }),
    createScorer<string, SearchCall[]>({
      name: "Queries are diverse (not repeated)",
      scorer: ({ output }) => {
        if (output.length <= 1) return 0;
        const queries = output.map((s) => s.query.toLowerCase());
        const unique = new Set(queries);
        // All queries should be unique
        return unique.size === queries.length ? 1 : 0.5;
      },
    }),
  ],
});
