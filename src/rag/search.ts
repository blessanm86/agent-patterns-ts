import BM25 from "okapibm25";
import { embedText, semanticSearch } from "./vector-store.js";
import type { Chunk, SearchResult, SearchMode } from "./types.js";

// ─── Search Module ──────────────────────────────────────────────────────────
//
// Three search strategies, unified behind searchDocs():
//   1. keyword  — BM25 (term frequency / inverse document frequency)
//   2. semantic — cosine similarity on embeddings
//   3. hybrid   — reciprocal rank fusion of BM25 + semantic

// ─── BM25 (Keyword Search) ─────────────────────────────────────────────────

export function bm25Search(query: string, chunks: Chunk[], topK: number): SearchResult[] {
  const documents = chunks.map((c) => c.content);
  const keywords = query.toLowerCase().split(/\s+/);

  const scores = BM25(documents, keywords) as number[];

  const results: SearchResult[] = chunks.map((chunk, i) => ({
    chunk,
    score: scores[i],
  }));

  results.sort((a, b) => b.score - a.score);
  return results.filter((r) => r.score > 0).slice(0, topK);
}

// ─── Reciprocal Rank Fusion ─────────────────────────────────────────────────

const RRF_K = 60; // standard RRF constant

function reciprocalRankFusion(
  lists: SearchResult[][],
  chunks: Chunk[],
  topK: number,
): SearchResult[] {
  const scores = new Map<string, number>();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank].chunk.id;
      const prev = scores.get(id) ?? 0;
      scores.set(id, prev + 1 / (RRF_K + rank + 1));
    }
  }

  const chunkMap = new Map(chunks.map((c) => [c.id, c]));
  const fused: SearchResult[] = [];

  for (const [id, score] of scores) {
    const chunk = chunkMap.get(id);
    if (chunk) {
      fused.push({ chunk, score });
    }
  }

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, topK);
}

// ─── Unified Search Dispatcher ──────────────────────────────────────────────

export async function searchDocs(
  query: string,
  chunks: Chunk[],
  mode: SearchMode,
  topK = 5,
): Promise<SearchResult[]> {
  switch (mode) {
    case "keyword":
      return bm25Search(query, chunks, topK);

    case "semantic": {
      const queryEmbedding = await embedText(query);
      return semanticSearch(queryEmbedding, chunks, topK);
    }

    case "hybrid": {
      const queryEmbedding = await embedText(query);
      const bm25Results = bm25Search(query, chunks, topK);
      const semanticResults = semanticSearch(queryEmbedding, chunks, topK);
      return reciprocalRankFusion([bm25Results, semanticResults], chunks, topK);
    }
  }
}
