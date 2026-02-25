// ─── Pattern 7: Semantic Similarity Evals ────────────────────────────────────
//
// Semantic similarity evals compare outputs using vector embeddings rather
// than exact string matching.
//
// When to use this over exact match or LLM judge:
//   - The correct response can be paraphrased many ways
//     ("$240 total" vs "240 dollars" vs "two forty")
//   - You have a reference answer but not a fixed canonical string
//   - Exact match is too brittle; LLM judge is too slow for your CI budget
//
// How it works:
//   1. Embed both strings with a local embedding model (nomic-embed-text)
//   2. Compute cosine similarity between the two vectors
//   3. Score = cosine similarity (0 to 1)
//
// The cosine similarity measures semantic closeness — two sentences with
// the same meaning but different words score high; unrelated sentences score low.
//
// Prerequisites: `ollama pull nomic-embed-text`
//
// If nomic-embed-text is not available, safeSimilarity() returns 0 with a
// warning instead of crashing the entire eval suite.

import { evalite, createScorer } from "evalite";
import ollama from "ollama";
import { runHotelAgent } from "../agent.js";
import { lastAssistantMessage } from "../../shared/eval-utils.js";
import { createMockExecutor, scenarios } from "../fixtures/mock-tools.js";

const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";
const SIMILARITY_THRESHOLD = 0.7;

// ─── Cosine Similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

// ─── safeSimilarity ───────────────────────────────────────────────────────────
//
// Graceful degradation: returns 0 with a console.warn if nomic-embed-text
// is missing or Ollama is unreachable. This prevents an optional dependency
// from failing the entire eval run.
//
// To install: ollama pull nomic-embed-text

async function safeSimilarity(textA: string, textB: string): Promise<number> {
  try {
    const [embA, embB] = await Promise.all([
      ollama.embed({ model: EMBED_MODEL, input: textA }),
      ollama.embed({ model: EMBED_MODEL, input: textB }),
    ]);
    const vecA = embA.embeddings[0];
    const vecB = embB.embeddings[0];
    if (!vecA || !vecB) return 0;
    return cosineSimilarity(vecA, vecB);
  } catch (err) {
    const error = err as Error;
    if (
      error.message?.includes("ECONNREFUSED") ||
      error.message?.includes("model") ||
      error.message?.includes("pull") ||
      error.message?.includes("not found")
    ) {
      console.warn(
        `[semantic-similarity] ${EMBED_MODEL} not available — returning 0. ` +
          "Run: ollama pull nomic-embed-text",
      );
    }
    return 0;
  }
}

// ─── Test 1: Availability response matches expected content ───────────────────
//
// The agent should return information semantically equivalent to the reference.
// The wording will differ — the meaning should be close.

evalite("Semantic similarity — availability response", {
  data: async () => [
    {
      input: "What rooms do you have available from 2026-06-10 to 2026-06-13?",
      expected:
        "We have suite rooms available for your dates at $350 per night, totaling $1050 for 3 nights.",
    },
  ],
  task: async (input) => {
    const executor = createMockExecutor(scenarios.onlySuiteAvailable);
    const history = await runHotelAgent(input.input, [], { executorFn: executor });
    return lastAssistantMessage(history);
  },
  scorers: [
    createScorer({
      name: `Semantic similarity ≥ ${SIMILARITY_THRESHOLD}`,
      scorer: async ({ input, output }) => safeSimilarity(output, input.expected),
    }),
  ],
});

// ─── Test 2: Paraphrase consistency ───────────────────────────────────────────
//
// Same underlying fact, different natural language phrasing.
// Embedding-based scoring handles paraphrases that would fail exact match.

evalite("Semantic similarity — paraphrase consistency", {
  data: async () => [
    {
      input: "How much for a suite for 2 nights?",
      // Agent might say "$700", "700 dollars", "two nights at $350 comes to $700"
      expected: "A suite costs $350 per night. For 2 nights, the total is $700.",
    },
  ],
  task: async (input) => {
    const executor = createMockExecutor({});
    const history = await runHotelAgent(input.input, [], { executorFn: executor });
    return lastAssistantMessage(history);
  },
  scorers: [
    createScorer({
      name: `Semantic similarity ≥ ${SIMILARITY_THRESHOLD}`,
      scorer: async ({ input, output }) => safeSimilarity(output, input.expected),
    }),
  ],
});

// ─── Test 3: Off-topic sanity check ───────────────────────────────────────────
//
// A hotel booking response should NOT be semantically similar to a biology text.
// This sanity check verifies the scorer is discriminating, not always high.
// If this test fails (similarity is high), your embedding model or threshold
// needs recalibration.

evalite("Semantic similarity — sanity check (low score expected)", {
  data: async () => [
    {
      input: "What rooms do you have available from 2026-06-10 to 2026-06-13?",
      // Completely unrelated — similarity should be low
      unrelated:
        "The mitochondria is the powerhouse of the cell. ATP synthesis drives cellular energy production.",
    },
  ],
  task: async (input) => {
    const executor = createMockExecutor(scenarios.onlySuiteAvailable);
    const history = await runHotelAgent(input.input, [], { executorFn: executor });
    return lastAssistantMessage(history);
  },
  scorers: [
    createScorer({
      name: "Low similarity to unrelated topic (scorer calibration)",
      scorer: async ({ input, output }) => {
        const sim = await safeSimilarity(output, input.unrelated);
        // A good discriminator: hotel response vs biology text should be < 0.5
        // Score = 1 if similarity is low (expected), 0 if similarity is high (miscalibrated)
        return sim < 0.5 ? 1 : 0;
      },
    }),
  ],
});
