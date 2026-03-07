// ─── Pre-Execution Validation Evals ─────────────────────────────────────────
//
// Tests that the shadow workspace pattern works correctly:
//   1. Valid edit → promoted to workspace (shadow mode)
//   2. Invalid edit → rejected with diagnostics (shadow mode)
//   3. Agent self-corrects after rejection and eventually gets promoted
//   4. Direct mode applies edits without validation
//   5. Shadow validation catches semantic errors (calorie mismatch)

import { evalite, createScorer } from "evalite";
import { runAgent, type AgentResult } from "../agent.js";
import { createWorkspace, validateFile, type Workspace } from "../shadow.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function seedWorkspace(): Workspace {
  return createWorkspace({
    "pad-thai.json": JSON.stringify({
      name: "Pad Thai",
      category: "dinner",
      difficulty: "medium",
      servings: 3,
      prepTimeMinutes: 30,
      ingredients: [
        { name: "rice noodles", quantity: 250, unit: "g" },
        { name: "shrimp", quantity: 200, unit: "g" },
        { name: "bean sprouts", quantity: 100, unit: "g" },
        { name: "fish sauce", quantity: 3, unit: "tbsp" },
        { name: "peanuts", quantity: 50, unit: "g" },
      ],
      instructions: [
        "Soak rice noodles in warm water for 20 minutes",
        "Stir-fry shrimp until pink",
        "Add noodles, fish sauce, and bean sprouts",
        "Garnish with crushed peanuts",
      ],
      nutrition: {
        caloriesPerServing: 410,
        proteinGrams: 22,
        carbsGrams: 48,
        fatGrams: 14,
      },
    }),
  });
}

// ─── 1. Valid Edit Gets Promoted ─────────────────────────────────────────────
//
// When the agent creates a valid recipe, the shadow workspace should promote it.

evalite("Shadow -- valid recipe creation is promoted", {
  data: async () => [
    { input: "Create a simple Greek salad recipe with cucumber, tomatoes, feta, and olives" },
  ],
  task: async (input) => {
    const workspace = seedWorkspace();
    const result = await runAgent(input, [], workspace, "shadow");
    return { result, fileCount: workspace.files.size };
  },
  scorers: [
    createScorer<string, { result: AgentResult; fileCount: number }>({
      name: "At least one shadow validation occurred",
      scorer: ({ output }) => (output.result.stats.shadowValidations > 0 ? 1 : 0),
    }),
    createScorer<string, { result: AgentResult; fileCount: number }>({
      name: "At least one edit was promoted",
      scorer: ({ output }) => (output.result.stats.promotions > 0 ? 1 : 0),
    }),
    createScorer<string, { result: AgentResult; fileCount: number }>({
      name: "New recipe file added to workspace",
      scorer: ({ output }) => (output.fileCount > 1 ? 1 : 0),
    }),
  ],
});

// ─── 2. Validation Unit Test: Invalid JSON Rejected ──────────────────────────
//
// Direct test of the validation layer — no LLM involved.

evalite("Shadow -- invalid JSON is rejected by validator", {
  data: async () => [{ input: "{ invalid json" }],
  task: async (input) => {
    return validateFile("test.json", input);
  },
  scorers: [
    createScorer<string, ReturnType<typeof validateFile>>({
      name: "Validation returns invalid",
      scorer: ({ output }) => (output.valid === false ? 1 : 0),
    }),
    createScorer<string, ReturnType<typeof validateFile>>({
      name: "Diagnostic mentions JSON parse error",
      scorer: ({ output }) =>
        output.diagnostics.some((d) => d.layer === "syntax" && d.message.includes("JSON")) ? 1 : 0,
    }),
  ],
});

// ─── 3. Validation Unit Test: Schema Violation Rejected ──────────────────────

evalite("Shadow -- schema violation (bad category) is rejected", {
  data: async () => [
    {
      input: JSON.stringify({
        name: "Test",
        category: "brunch", // invalid — not in the enum
        difficulty: "easy",
        servings: 2,
        prepTimeMinutes: 10,
        ingredients: [{ name: "egg", quantity: 2, unit: "whole" }],
        instructions: ["Scramble the egg"],
        nutrition: { caloriesPerServing: 140, proteinGrams: 12, carbsGrams: 1, fatGrams: 10 },
      }),
    },
  ],
  task: async (input) => {
    return validateFile("test.json", input);
  },
  scorers: [
    createScorer<string, ReturnType<typeof validateFile>>({
      name: "Validation returns invalid",
      scorer: ({ output }) => (output.valid === false ? 1 : 0),
    }),
    createScorer<string, ReturnType<typeof validateFile>>({
      name: "Diagnostic is from schema layer",
      scorer: ({ output }) => (output.diagnostics.some((d) => d.layer === "schema") ? 1 : 0),
    }),
  ],
});

// ─── 4. Validation Unit Test: Calorie Mismatch Caught ────────────────────────

evalite("Shadow -- semantic: calorie mismatch caught", {
  data: async () => [
    {
      input: JSON.stringify({
        name: "Misleading Meal",
        category: "dinner",
        difficulty: "easy",
        servings: 1,
        prepTimeMinutes: 10,
        ingredients: [{ name: "chicken", quantity: 200, unit: "g" }],
        instructions: ["Cook the chicken"],
        nutrition: {
          caloriesPerServing: 100, // way too low for 50g protein + 20g fat
          proteinGrams: 50,
          carbsGrams: 0,
          fatGrams: 20,
        },
      }),
    },
  ],
  task: async (input) => {
    return validateFile("test.json", input);
  },
  scorers: [
    createScorer<string, ReturnType<typeof validateFile>>({
      name: "Validation returns invalid",
      scorer: ({ output }) => (output.valid === false ? 1 : 0),
    }),
    createScorer<string, ReturnType<typeof validateFile>>({
      name: "Diagnostic mentions calorie mismatch",
      scorer: ({ output }) =>
        output.diagnostics.some(
          (d) => d.layer === "semantic" && d.message.toLowerCase().includes("calorie"),
        )
          ? 1
          : 0,
    }),
  ],
});

// ─── 5. Direct Mode Skips Validation ─────────────────────────────────────────
//
// In direct mode, edits apply immediately — even invalid ones.

evalite("Shadow -- direct mode applies without validation", {
  data: async () => [{ input: "Create a quick toast recipe" }],
  task: async (input) => {
    const workspace = seedWorkspace();
    const result = await runAgent(input, [], workspace, "direct");
    return { result, fileCount: workspace.files.size };
  },
  scorers: [
    createScorer<string, { result: AgentResult; fileCount: number }>({
      name: "Zero shadow validations in direct mode",
      scorer: ({ output }) => (output.result.stats.shadowValidations === 0 ? 1 : 0),
    }),
    createScorer<string, { result: AgentResult; fileCount: number }>({
      name: "Edit was applied (file added)",
      scorer: ({ output }) => (output.fileCount > 1 ? 1 : 0),
    }),
  ],
});
