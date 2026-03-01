// ─── Persistent Memory Evals ────────────────────────────────────────────────
//
// 4 groups:
//   1. Extraction (LLM-dependent) — dietary restriction → high importance fact
//   2. Privacy (deterministic) — SSN/CC blocked, clean fact passes
//   3. Deduplication (deterministic) — near-identical facts detected
//   4. Contrast mode (LLM-dependent) — with-memory has extraction call

import { evalite, createScorer } from "evalite";
import { extractMemories, type ExtractionCallResult } from "../memory-extractor.js";
import { checkForPII, type PIICheckResult } from "../privacy.js";
import { PersistentMemoryStore } from "../memory-store.js";
import { runAgent, type AgentResult } from "../agent.js";
import type { Message } from "../../shared/types.js";

// ─── Group 1: Extraction (LLM-dependent) ────────────────────────────────────

evalite("Extraction — dietary restriction yields high-importance fact", {
  data: async () => [
    {
      input: [
        { role: "user", content: "I'm vegetarian and I live near Midtown" },
        {
          role: "assistant",
          content:
            "Great to know! Being vegetarian and living near Midtown, I can recommend several restaurants with excellent vegetarian options in your area.",
        },
      ] as Message[],
    },
  ],
  task: async (input) => extractMemories(input, []),
  scorers: [
    createScorer<Message[], ExtractionCallResult>({
      name: "no error",
      scorer: ({ output }) => (output.error === null ? 1 : 0),
    }),
    createScorer<Message[], ExtractionCallResult>({
      name: "extracts at least 1 fact",
      scorer: ({ output }) => (output.result && output.result.facts.length >= 1 ? 1 : 0),
    }),
    createScorer<Message[], ExtractionCallResult>({
      name: "at least one fact mentions vegetarian",
      scorer: ({ output }) => {
        if (!output.result) return 0;
        return output.result.facts.some((f) => f.content.toLowerCase().includes("vegetarian"))
          ? 1
          : 0;
      },
    }),
    createScorer<Message[], ExtractionCallResult>({
      name: "dietary fact has importance >= 7",
      scorer: ({ output }) => {
        if (!output.result) return 0;
        const dietary = output.result.facts.find(
          (f) => f.category === "dietary" || f.content.toLowerCase().includes("vegetarian"),
        );
        return dietary && dietary.importance >= 7 ? 1 : 0;
      },
    }),
  ],
});

evalite("Extraction — greeting yields empty facts", {
  data: async () => [
    {
      input: [
        { role: "user", content: "Hello!" },
        {
          role: "assistant",
          content: "Hi there! How can I help you find a great restaurant today?",
        },
      ] as Message[],
    },
  ],
  task: async (input) => extractMemories(input, []),
  scorers: [
    createScorer<Message[], ExtractionCallResult>({
      name: "no error",
      scorer: ({ output }) => (output.error === null ? 1 : 0),
    }),
    createScorer<Message[], ExtractionCallResult>({
      name: "empty facts array",
      scorer: ({ output }) => (output.result && output.result.facts.length === 0 ? 1 : 0),
    }),
  ],
});

evalite("Extraction — forget request detected", {
  data: async () => [
    {
      input: [
        { role: "user", content: "Actually, forget that I like sushi. I don't eat fish anymore." },
        {
          role: "assistant",
          content:
            "No problem! I'll forget your sushi preference. Since you don't eat fish anymore, I'll keep that in mind for future recommendations.",
        },
      ] as Message[],
    },
  ],
  task: async (input) => extractMemories(input, ["User likes sushi"]),
  scorers: [
    createScorer<Message[], ExtractionCallResult>({
      name: "no error",
      scorer: ({ output }) => (output.error === null ? 1 : 0),
    }),
    createScorer<Message[], ExtractionCallResult>({
      name: "has at least 1 forget request",
      scorer: ({ output }) => (output.result && output.result.forgetRequests.length >= 1 ? 1 : 0),
    }),
  ],
});

// ─── Group 2: Privacy (deterministic) ───────────────────────────────────────

evalite("Privacy — SSN is blocked", {
  data: async () => [{ input: "User's SSN is 123-45-6789" }],
  task: async (input) => checkForPII(input),
  scorers: [
    createScorer<string, PIICheckResult>({
      name: "not safe",
      scorer: ({ output }) => (output.isSafe === false ? 1 : 0),
    }),
    createScorer<string, PIICheckResult>({
      name: "flags SSN pattern",
      scorer: ({ output }) => (output.flaggedPatterns.includes("SSN") ? 1 : 0),
    }),
  ],
});

evalite("Privacy — credit card is blocked", {
  data: async () => [{ input: "User's card is 4111-1111-1111-1111" }],
  task: async (input) => checkForPII(input),
  scorers: [
    createScorer<string, PIICheckResult>({
      name: "not safe",
      scorer: ({ output }) => (output.isSafe === false ? 1 : 0),
    }),
    createScorer<string, PIICheckResult>({
      name: "flags credit-card pattern",
      scorer: ({ output }) => (output.flaggedPatterns.includes("credit-card") ? 1 : 0),
    }),
  ],
});

evalite("Privacy — clean fact passes", {
  data: async () => [{ input: "User is vegetarian" }],
  task: async (input) => checkForPII(input),
  scorers: [
    createScorer<string, PIICheckResult>({
      name: "is safe",
      scorer: ({ output }) => (output.isSafe === true ? 1 : 0),
    }),
    createScorer<string, PIICheckResult>({
      name: "no flagged patterns",
      scorer: ({ output }) => (output.flaggedPatterns.length === 0 ? 1 : 0),
    }),
  ],
});

// ─── Group 3: Deduplication (deterministic) ─────────────────────────────────

evalite("Dedup — near-identical facts detected", {
  data: async () => [
    {
      input: {
        existingContent: "User is vegetarian",
        newContent: "User is vegetarian and prefers plant-based",
        category: "dietary" as const,
      },
    },
  ],
  task: async (input) => {
    const store = new PersistentMemoryStore("/tmp/test-dedup-eval.json");
    store.clearAll();
    store.addFact(input.existingContent, input.category, 8);
    return store.deduplicate(input.newContent, input.category);
  },
  scorers: [
    createScorer<
      { existingContent: string; newContent: string; category: string },
      ReturnType<PersistentMemoryStore["deduplicate"]>
    >({
      name: "detects duplicate",
      scorer: ({ output }) => (output !== null ? 1 : 0),
    }),
  ],
});

evalite("Dedup — unrelated facts pass", {
  data: async () => [
    {
      input: {
        existingContent: "User is vegetarian",
        newContent: "User lives near Midtown",
        category: "location" as const,
      },
    },
  ],
  task: async (input) => {
    const store = new PersistentMemoryStore("/tmp/test-dedup-pass-eval.json");
    store.clearAll();
    store.addFact(input.existingContent, "dietary", 8);
    return store.deduplicate(input.newContent, input.category);
  },
  scorers: [
    createScorer<
      { existingContent: string; newContent: string; category: string },
      ReturnType<PersistentMemoryStore["deduplicate"]>
    >({
      name: "no duplicate found",
      scorer: ({ output }) => (output === null ? 1 : 0),
    }),
  ],
});

// ─── Group 4: Contrast Mode (LLM-dependent) ────────────────────────────────

type ContrastResult = { withMemory: AgentResult; noMemory: AgentResult };

evalite("Contrast — with-memory has extraction call (1 more LLM call)", {
  data: async () => [{ input: "I'm vegetarian and live near Midtown" }],
  task: async (input) => {
    const store = new PersistentMemoryStore("/tmp/test-contrast-eval.json");
    store.clearAll();
    const withMemory = await runAgent(input, [], "with-memory", store);
    const noMemory = await runAgent(input, [], "no-memory");
    return { withMemory, noMemory };
  },
  scorers: [
    createScorer<string, ContrastResult>({
      name: "with-memory has more LLM calls than no-memory",
      scorer: ({ output }) =>
        output.withMemory.stats.llmCalls > output.noMemory.stats.llmCalls ? 1 : 0,
    }),
    createScorer<string, ContrastResult>({
      name: "with-memory extracts at least 1 fact",
      scorer: ({ output }) => (output.withMemory.stats.memoriesExtracted >= 1 ? 1 : 0),
    }),
    createScorer<string, ContrastResult>({
      name: "no-memory extracts 0 facts",
      scorer: ({ output }) => (output.noMemory.stats.memoriesExtracted === 0 ? 1 : 0),
    }),
  ],
});
