import ollama from "ollama";
import { EMBEDDING_MODEL } from "../shared/config.js";
import type { Chunk, SearchResult } from "./types.js";

// ─── Vector Store ───────────────────────────────────────────────────────────
//
// Handles embedding generation and brute-force semantic search.
// Uses Ollama's embedding API with the nomic-embed-text model.
// No external vector DB needed — we embed in memory and do cosine similarity.

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function embedText(text: string): Promise<number[]> {
  const response = await ollama.embed({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.embeddings[0];
}

export async function embedChunks(chunks: Chunk[]): Promise<Chunk[]> {
  const batchSize = 20;
  const embedded: Chunk[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.content);

    const response = await ollama.embed({
      model: EMBEDDING_MODEL,
      input: texts,
    });

    for (let j = 0; j < batch.length; j++) {
      embedded.push({
        ...batch[j],
        embedding: response.embeddings[j],
      });
    }

    const done = Math.min(i + batchSize, chunks.length);
    process.stdout.write(`\r  Embedding chunks: ${done}/${chunks.length}`);
  }
  console.log(); // newline after progress

  return embedded;
}

export function semanticSearch(query: number[], chunks: Chunk[], topK: number): SearchResult[] {
  const scored: SearchResult[] = [];

  for (const chunk of chunks) {
    if (!chunk.embedding) continue;
    const score = cosineSimilarity(query, chunk.embedding);
    scored.push({ chunk, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
