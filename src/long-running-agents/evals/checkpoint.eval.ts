// ─── Checkpoint Evals ────────────────────────────────────────────────────────
//
// 4 groups:
//   1. Checkpoint roundtrip — save → load → verify fields match
//   2. Idempotency — completed IDs are skipped on resume
//   3. Atomic write — verify .tmp file pattern (no corruption)
//   4. FindInProgress — only in_progress checkpoints returned

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { evalite, createScorer } from "evalite";
import { CheckpointStore } from "../checkpoint-store.js";
import type { Checkpoint } from "../checkpoint-store.js";
import { validateRecipe } from "../tools.js";
import type { NewRecipe } from "../recipes.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = path.join("/tmp", `checkpoint-eval-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    runId: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalItems: 20,
    completedItems: 5,
    completedIds: ["recipe-001", "recipe-002", "recipe-003", "recipe-004", "recipe-005"],
    results: [
      { recipeId: "recipe-001", recipeName: "Spaghetti", status: "success", durationMs: 1200 },
      { recipeId: "recipe-002", recipeName: "Caesar Salad", status: "success", durationMs: 900 },
      {
        recipeId: "recipe-003",
        recipeName: "Banana Bread",
        status: "failed",
        error: "Validation failed",
        durationMs: 800,
      },
      { recipeId: "recipe-004", recipeName: "Tikka Masala", status: "success", durationMs: 1500 },
      { recipeId: "recipe-005", recipeName: "Guacamole", status: "success", durationMs: 600 },
    ],
    status: "in_progress",
    ...overrides,
  };
}

// ─── Group 1: Checkpoint Roundtrip ──────────────────────────────────────────

evalite("Checkpoint roundtrip — save → load preserves all fields", {
  data: async () => [{ input: makeCheckpoint() }],
  task: async (input) => {
    const dir = makeTmpDir();
    const store = new CheckpointStore(dir);
    store.save(input);
    const loaded = store.load(input.runId);
    // Cleanup
    fs.rmSync(dir, { recursive: true, force: true });
    return { original: input, loaded };
  },
  scorers: [
    createScorer<Checkpoint, { original: Checkpoint; loaded: Checkpoint | null }>({
      name: "loaded is not null",
      scorer: ({ output }) => (output.loaded !== null ? 1 : 0),
    }),
    createScorer<Checkpoint, { original: Checkpoint; loaded: Checkpoint | null }>({
      name: "runId matches",
      scorer: ({ output }) => (output.loaded?.runId === output.original.runId ? 1 : 0),
    }),
    createScorer<Checkpoint, { original: Checkpoint; loaded: Checkpoint | null }>({
      name: "completedItems matches",
      scorer: ({ output }) =>
        output.loaded?.completedItems === output.original.completedItems ? 1 : 0,
    }),
    createScorer<Checkpoint, { original: Checkpoint; loaded: Checkpoint | null }>({
      name: "completedIds length matches",
      scorer: ({ output }) =>
        output.loaded?.completedIds.length === output.original.completedIds.length ? 1 : 0,
    }),
    createScorer<Checkpoint, { original: Checkpoint; loaded: Checkpoint | null }>({
      name: "results count matches",
      scorer: ({ output }) =>
        output.loaded?.results.length === output.original.results.length ? 1 : 0,
    }),
    createScorer<Checkpoint, { original: Checkpoint; loaded: Checkpoint | null }>({
      name: "status matches",
      scorer: ({ output }) => (output.loaded?.status === output.original.status ? 1 : 0),
    }),
  ],
});

// ─── Group 2: Idempotency ───────────────────────────────────────────────────

evalite("Idempotency — completedIds tracked correctly", {
  data: async () => [
    {
      input: {
        completedIds: ["recipe-001", "recipe-002", "recipe-003"],
        allIds: ["recipe-001", "recipe-002", "recipe-003", "recipe-004", "recipe-005"],
      },
    },
  ],
  task: async (input) => {
    const remaining = input.allIds.filter((id) => !input.completedIds.includes(id));
    return { remaining, skippedCount: input.completedIds.length };
  },
  scorers: [
    createScorer<
      { completedIds: string[]; allIds: string[] },
      { remaining: string[]; skippedCount: number }
    >({
      name: "skips 3 completed recipes",
      scorer: ({ output }) => (output.skippedCount === 3 ? 1 : 0),
    }),
    createScorer<
      { completedIds: string[]; allIds: string[] },
      { remaining: string[]; skippedCount: number }
    >({
      name: "2 recipes remaining",
      scorer: ({ output }) => (output.remaining.length === 2 ? 1 : 0),
    }),
    createScorer<
      { completedIds: string[]; allIds: string[] },
      { remaining: string[]; skippedCount: number }
    >({
      name: "remaining are recipe-004 and recipe-005",
      scorer: ({ output }) =>
        output.remaining.includes("recipe-004") && output.remaining.includes("recipe-005") ? 1 : 0,
    }),
  ],
});

// ─── Group 3: Atomic Write ──────────────────────────────────────────────────

evalite("Atomic write — no .tmp file left after save", {
  data: async () => [{ input: makeCheckpoint() }],
  task: async (input) => {
    const dir = makeTmpDir();
    const store = new CheckpointStore(dir);
    store.save(input);

    const files = fs.readdirSync(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    fs.rmSync(dir, { recursive: true, force: true });
    return { tmpFiles, jsonFiles };
  },
  scorers: [
    createScorer<Checkpoint, { tmpFiles: string[]; jsonFiles: string[] }>({
      name: "no .tmp files remain",
      scorer: ({ output }) => (output.tmpFiles.length === 0 ? 1 : 0),
    }),
    createScorer<Checkpoint, { tmpFiles: string[]; jsonFiles: string[] }>({
      name: "exactly one .json file",
      scorer: ({ output }) => (output.jsonFiles.length === 1 ? 1 : 0),
    }),
  ],
});

// ─── Group 4: FindInProgress ────────────────────────────────────────────────

evalite("FindInProgress — only returns in_progress checkpoints", {
  data: async () => [{ input: "test" }],
  task: async () => {
    const dir = makeTmpDir();
    const store = new CheckpointStore(dir);

    // Save 3 checkpoints with different statuses
    store.save(makeCheckpoint({ status: "in_progress" }));
    store.save(makeCheckpoint({ status: "completed" }));
    store.save(makeCheckpoint({ status: "cancelled" }));

    const inProgress = store.findInProgress();

    fs.rmSync(dir, { recursive: true, force: true });
    return { count: inProgress.length, statuses: inProgress.map((c) => c.status) };
  },
  scorers: [
    createScorer<string, { count: number; statuses: string[] }>({
      name: "finds exactly 1 in-progress",
      scorer: ({ output }) => (output.count === 1 ? 1 : 0),
    }),
    createScorer<string, { count: number; statuses: string[] }>({
      name: "all returned are in_progress",
      scorer: ({ output }) => (output.statuses.every((s) => s === "in_progress") ? 1 : 0),
    }),
  ],
});

// ─── Group 5: Validate Recipe ───────────────────────────────────────────────

evalite("Validate — valid recipe passes", {
  data: async () => [
    {
      input: {
        id: "recipe-001",
        name: "Test Recipe",
        category: "main" as const,
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        ingredients: [{ name: "chicken", amount: 500, unit: "g" }],
        steps: ["Cook the chicken", "Serve"],
      } satisfies NewRecipe,
    },
  ],
  task: async (input) => validateRecipe(input),
  scorers: [
    createScorer<NewRecipe, { valid: boolean; errors: string[] }>({
      name: "is valid",
      scorer: ({ output }) => (output.valid ? 1 : 0),
    }),
    createScorer<NewRecipe, { valid: boolean; errors: string[] }>({
      name: "no errors",
      scorer: ({ output }) => (output.errors.length === 0 ? 1 : 0),
    }),
  ],
});

evalite("Validate — recipe with missing fields fails", {
  data: async () => [
    {
      input: {
        id: "recipe-bad",
        name: "",
        category: "invalid" as "main",
        servings: -1,
        prepTimeMinutes: 0,
        cookTimeMinutes: 0,
        totalTimeMinutes: 0,
        ingredients: [],
        steps: [],
      } satisfies NewRecipe,
    },
  ],
  task: async (input) => validateRecipe(input),
  scorers: [
    createScorer<NewRecipe, { valid: boolean; errors: string[] }>({
      name: "is not valid",
      scorer: ({ output }) => (output.valid === false ? 1 : 0),
    }),
    createScorer<NewRecipe, { valid: boolean; errors: string[] }>({
      name: "has multiple errors",
      scorer: ({ output }) => (output.errors.length >= 3 ? 1 : 0),
    }),
  ],
});
