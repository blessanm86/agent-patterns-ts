import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent } from "./agent.js";
import { createWorkspace } from "./shadow.js";
import type { AgentMode } from "./tools.js";

// ─── Seed Data ───────────────────────────────────────────────────────────────
//
// Pre-populated workspace with two recipes so users can immediately
// try editing existing files (not just creating from scratch).

const SEED_RECIPES: Record<string, string> = {
  "chicken-tikka.json": JSON.stringify(
    {
      name: "Chicken Tikka Masala",
      category: "dinner",
      difficulty: "medium",
      servings: 4,
      prepTimeMinutes: 45,
      ingredients: [
        { name: "chicken breast", quantity: 600, unit: "g" },
        { name: "yogurt", quantity: 200, unit: "ml" },
        { name: "tomato puree", quantity: 400, unit: "g" },
        { name: "heavy cream", quantity: 150, unit: "ml" },
        { name: "onion", quantity: 2, unit: "whole" },
        { name: "garlic", quantity: 4, unit: "whole" },
        { name: "garam masala", quantity: 2, unit: "tsp" },
        { name: "turmeric", quantity: 1, unit: "tsp" },
        { name: "basmati rice", quantity: 300, unit: "g" },
      ],
      instructions: [
        "Marinate chicken in yogurt with garam masala and turmeric for 30 minutes",
        "Grill or pan-fry the chicken until charred",
        "Sauté onion and garlic until golden",
        "Add tomato puree and simmer for 15 minutes",
        "Stir in heavy cream and the cooked chicken",
        "Serve over basmati rice",
      ],
      nutrition: {
        caloriesPerServing: 485,
        proteinGrams: 38,
        carbsGrams: 42,
        fatGrams: 18,
      },
    },
    null,
    2,
  ),
  "caesar-salad.json": JSON.stringify(
    {
      name: "Caesar Salad",
      category: "lunch",
      difficulty: "easy",
      servings: 2,
      prepTimeMinutes: 15,
      ingredients: [
        { name: "romaine lettuce", quantity: 1, unit: "whole" },
        { name: "parmesan cheese", quantity: 50, unit: "g" },
        { name: "croutons", quantity: 100, unit: "g" },
        { name: "caesar dressing", quantity: 60, unit: "ml" },
        { name: "lemon juice", quantity: 1, unit: "tbsp" },
      ],
      instructions: [
        "Wash and chop romaine lettuce into bite-sized pieces",
        "Toss lettuce with caesar dressing and lemon juice",
        "Top with shaved parmesan cheese and croutons",
      ],
      nutrition: {
        caloriesPerServing: 320,
        proteinGrams: 12,
        carbsGrams: 22,
        fatGrams: 22,
      },
    },
    null,
    2,
  ),
};

// ─── CLI ─────────────────────────────────────────────────────────────────────

const mode: AgentMode = process.argv.includes("--direct") ? "direct" : "shadow";
const workspace = createWorkspace(SEED_RECIPES);

const cli = createCLI({
  title: `Pre-Execution Validation (Shadow Workspace) — ${mode} mode`,
  emoji: "\uD83D\uDD0D",
  goodbye: "Goodbye!",
  agentLabel: "Recipe",
  welcomeLines: [
    `    Mode: ${mode === "shadow" ? "\uD83D\uDD0D Shadow (clone \u2192 apply \u2192 validate \u2192 promote/discard)" : "\u26A1 Direct (apply immediately, no validation)"}`,
    `    Workspace: ${workspace.files.size} recipe(s) loaded`,
    "",
    "  Try these prompts:",
    '    \u2022 "Create a Thai green curry recipe"',
    '    \u2022 "Add a chocolate lava cake dessert"',
    '    \u2022 "Update the chicken tikka to serve 6 people"',
    '    \u2022 "Create a quick breakfast smoothie bowl"',
    "",
    "  Commands:",
    "    /files — list all recipe files in workspace",
    "",
  ],
  onMessage: async (input, history) => {
    const result = await runAgent(input, history, workspace, mode);
    const s = result.stats;

    const shadowInfo =
      s.shadowValidations > 0
        ? ` | ${s.shadowValidations} shadow validation${s.shadowValidations > 1 ? "s" : ""}: ${s.validationPasses} passed, ${s.validationFailures} rejected, ${s.promotions} promoted`
        : mode === "shadow"
          ? " | no edits attempted"
          : " | direct mode (no validation)";

    return {
      messages: result.messages,
      stats: [
        "",
        `  \uD83D\uDCCA Stats: ${s.llmCalls} LLM calls, ${s.toolCalls} tool calls${shadowInfo} [${s.mode}]`,
      ],
    };
  },
  onCommand: (command) => {
    if (command === "/files") {
      console.log("\n  Workspace files:");
      if (workspace.files.size === 0) {
        console.log("    (empty)");
      } else {
        for (const [filename, content] of workspace.files) {
          try {
            const parsed = JSON.parse(content);
            console.log(`    ${filename} — ${parsed.name} (${parsed.category})`);
          } catch {
            console.log(`    ${filename} — (invalid JSON)`);
          }
        }
      }
      return true;
    }
    return false;
  },
});

cli.start();
