// ─── Eval: Search Relevance ─────────────────────────────────────────────────
//
// Checks that searchDocs() returns chunks from the correct source documents.
// This tests the retrieval pipeline in isolation — no LLM involved.

import { evalite, createScorer } from "evalite";
import { documents } from "../knowledge-base.js";
import { chunkDocuments } from "../chunker.js";
import { embedChunks } from "../vector-store.js";
import { searchDocs } from "../search.js";
import type { SearchResult } from "../types.js";

// Build index once, shared across all test cases
let indexedChunks: Awaited<ReturnType<typeof embedChunks>> | null = null;

async function getChunks() {
  if (!indexedChunks) {
    const chunks = chunkDocuments(documents);
    indexedChunks = await embedChunks(chunks);
  }
  return indexedChunks;
}

evalite("RAG — search returns relevant chunks", {
  data: async () => [
    {
      input: "What port does NexusDB listen on?",
      expected: "getting-started",
    },
    {
      input: "How to set up replication between nodes?",
      expected: "replication",
    },
    {
      input: "How to create a backup of my database?",
      expected: "backup-restore",
    },
    {
      input: "What index types does NexusDB support?",
      expected: "indexing",
    },
  ],
  task: async (input) => {
    const chunks = await getChunks();
    const results = await searchDocs(input, chunks, "hybrid", 5);
    return results;
  },
  scorers: [
    createScorer<{ input: string; expected: string }, SearchResult[]>({
      name: "Expected doc in top 3",
      scorer: ({ output, expected }) => {
        const top3Sources = output.slice(0, 3).map((r) => r.chunk.source);
        return top3Sources.includes(expected) ? 1 : 0;
      },
    }),
    createScorer<{ input: string; expected: string }, SearchResult[]>({
      name: "Expected doc in top 5",
      scorer: ({ output, expected }) => {
        const top5Sources = output.slice(0, 5).map((r) => r.chunk.source);
        return top5Sources.includes(expected) ? 1 : 0;
      },
    }),
  ],
});
