// ─── Tool Definitions + Recipe Data ───────────────────────────────────────────
//
// Three tools for the recipe calculator agent:
//   1. execute_code — run JavaScript in a sandboxed child process
//   2. get_recipe_data — look up recipe by name (also callable from inside sandbox)
//   3. pool_status — introspect the sandbox pool

import type { ToolDefinition } from "./types.js";
import type { SandboxPool } from "./sandbox-pool.js";
import { logToolCall } from "../shared/logging.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description:
        "Execute JavaScript code in a sandboxed environment. The code runs in an isolated process with limited globals (Math, JSON, Date, parseInt, parseFloat, console.log). Use console.log() to output results. You can call `await callTool('get_recipe_data', { name: 'recipe name' })` from inside the code to fetch recipe data.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The JavaScript code to execute",
          },
          description: {
            type: "string",
            description: "Brief description of what the code does",
          },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recipe_data",
      description:
        "Look up a recipe by name. Returns ingredients with quantities, nutritional info (calories, protein, carbs, fat per serving), servings count, and prep time.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Recipe name to look up (e.g. 'pad thai', 'banana bread')",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pool_status",
      description:
        "Show the current status of the sandbox pool — how many sandboxes are idle, busy, or dead, plus affinity bindings and active tokens.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ─── Recipe Database ──────────────────────────────────────────────────────────

interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
}

interface Recipe {
  name: string;
  servings: number;
  prepTimeMinutes: number;
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  ingredients: Ingredient[];
}

const RECIPE_DATABASE: Record<string, Recipe> = {
  "chicken tikka masala": {
    name: "Chicken Tikka Masala",
    servings: 4,
    prepTimeMinutes: 45,
    caloriesPerServing: 485,
    proteinPerServing: 38,
    carbsPerServing: 18,
    fatPerServing: 28,
    ingredients: [
      { name: "chicken breast", quantity: 600, unit: "g" },
      { name: "yogurt", quantity: 200, unit: "ml" },
      { name: "tomato puree", quantity: 400, unit: "g" },
      { name: "heavy cream", quantity: 150, unit: "ml" },
      { name: "onion", quantity: 2, unit: "whole" },
      { name: "garlic", quantity: 4, unit: "cloves" },
      { name: "ginger", quantity: 1, unit: "tbsp" },
      { name: "garam masala", quantity: 2, unit: "tsp" },
      { name: "turmeric", quantity: 1, unit: "tsp" },
      { name: "basmati rice", quantity: 300, unit: "g" },
    ],
  },
  "caesar salad": {
    name: "Caesar Salad",
    servings: 2,
    prepTimeMinutes: 15,
    caloriesPerServing: 320,
    proteinPerServing: 12,
    carbsPerServing: 14,
    fatPerServing: 24,
    ingredients: [
      { name: "romaine lettuce", quantity: 1, unit: "head" },
      { name: "parmesan cheese", quantity: 50, unit: "g" },
      { name: "croutons", quantity: 100, unit: "g" },
      { name: "caesar dressing", quantity: 60, unit: "ml" },
      { name: "lemon juice", quantity: 1, unit: "tbsp" },
      { name: "anchovy fillets", quantity: 4, unit: "whole" },
    ],
  },
  "banana bread": {
    name: "Banana Bread",
    servings: 8,
    prepTimeMinutes: 70,
    caloriesPerServing: 265,
    proteinPerServing: 4,
    carbsPerServing: 42,
    fatPerServing: 10,
    ingredients: [
      { name: "ripe bananas", quantity: 3, unit: "whole" },
      { name: "all-purpose flour", quantity: 280, unit: "g" },
      { name: "sugar", quantity: 150, unit: "g" },
      { name: "butter", quantity: 75, unit: "g" },
      { name: "egg", quantity: 1, unit: "whole" },
      { name: "baking soda", quantity: 1, unit: "tsp" },
      { name: "vanilla extract", quantity: 1, unit: "tsp" },
      { name: "salt", quantity: 0.5, unit: "tsp" },
    ],
  },
  "pad thai": {
    name: "Pad Thai",
    servings: 3,
    prepTimeMinutes: 30,
    caloriesPerServing: 410,
    proteinPerServing: 22,
    carbsPerServing: 48,
    fatPerServing: 14,
    ingredients: [
      { name: "rice noodles", quantity: 250, unit: "g" },
      { name: "shrimp", quantity: 200, unit: "g" },
      { name: "firm tofu", quantity: 150, unit: "g" },
      { name: "bean sprouts", quantity: 100, unit: "g" },
      { name: "egg", quantity: 2, unit: "whole" },
      { name: "fish sauce", quantity: 3, unit: "tbsp" },
      { name: "tamarind paste", quantity: 2, unit: "tbsp" },
      { name: "peanuts", quantity: 50, unit: "g" },
      { name: "green onion", quantity: 3, unit: "stalks" },
      { name: "lime", quantity: 1, unit: "whole" },
    ],
  },
  "greek salad": {
    name: "Greek Salad",
    servings: 2,
    prepTimeMinutes: 10,
    caloriesPerServing: 230,
    proteinPerServing: 8,
    carbsPerServing: 10,
    fatPerServing: 18,
    ingredients: [
      { name: "cucumber", quantity: 1, unit: "whole" },
      { name: "tomatoes", quantity: 3, unit: "whole" },
      { name: "red onion", quantity: 0.5, unit: "whole" },
      { name: "feta cheese", quantity: 100, unit: "g" },
      { name: "kalamata olives", quantity: 80, unit: "g" },
      { name: "olive oil", quantity: 3, unit: "tbsp" },
      { name: "oregano", quantity: 1, unit: "tsp" },
    ],
  },
  "spaghetti carbonara": {
    name: "Spaghetti Carbonara",
    servings: 4,
    prepTimeMinutes: 25,
    caloriesPerServing: 520,
    proteinPerServing: 24,
    carbsPerServing: 58,
    fatPerServing: 22,
    ingredients: [
      { name: "spaghetti", quantity: 400, unit: "g" },
      { name: "guanciale", quantity: 200, unit: "g" },
      { name: "egg yolks", quantity: 4, unit: "whole" },
      { name: "pecorino romano", quantity: 100, unit: "g" },
      { name: "black pepper", quantity: 2, unit: "tsp" },
    ],
  },
  "chocolate chip cookies": {
    name: "Chocolate Chip Cookies",
    servings: 24,
    prepTimeMinutes: 35,
    caloriesPerServing: 180,
    proteinPerServing: 2,
    carbsPerServing: 24,
    fatPerServing: 9,
    ingredients: [
      { name: "all-purpose flour", quantity: 280, unit: "g" },
      { name: "butter", quantity: 230, unit: "g" },
      { name: "brown sugar", quantity: 200, unit: "g" },
      { name: "white sugar", quantity: 100, unit: "g" },
      { name: "eggs", quantity: 2, unit: "whole" },
      { name: "vanilla extract", quantity: 2, unit: "tsp" },
      { name: "baking soda", quantity: 1, unit: "tsp" },
      { name: "salt", quantity: 1, unit: "tsp" },
      { name: "chocolate chips", quantity: 340, unit: "g" },
    ],
  },
  "vegetable stir fry": {
    name: "Vegetable Stir Fry",
    servings: 3,
    prepTimeMinutes: 20,
    caloriesPerServing: 195,
    proteinPerServing: 8,
    carbsPerServing: 22,
    fatPerServing: 9,
    ingredients: [
      { name: "broccoli", quantity: 200, unit: "g" },
      { name: "bell pepper", quantity: 2, unit: "whole" },
      { name: "carrots", quantity: 2, unit: "whole" },
      { name: "snap peas", quantity: 150, unit: "g" },
      { name: "soy sauce", quantity: 3, unit: "tbsp" },
      { name: "sesame oil", quantity: 1, unit: "tbsp" },
      { name: "garlic", quantity: 3, unit: "cloves" },
      { name: "ginger", quantity: 1, unit: "tbsp" },
      { name: "cornstarch", quantity: 1, unit: "tbsp" },
    ],
  },
};

// ─── Tool Implementations ─────────────────────────────────────────────────────

function getRecipeData(args: { name: string }): string {
  const key = args.name.toLowerCase().trim();
  const recipe = RECIPE_DATABASE[key];

  if (!recipe) {
    const available = Object.keys(RECIPE_DATABASE).join(", ");
    return JSON.stringify({
      error: `Recipe "${args.name}" not found. Available: ${available}`,
    });
  }

  return JSON.stringify(recipe, null, 2);
}

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, string>,
  pool: SandboxPool,
  sandboxId: string,
): Promise<string> {
  switch (name) {
    case "execute_code": {
      const result = await pool.execute(sandboxId, args.code);
      const display = result.success ? result.output : `Error: ${result.error}\n${result.output}`;
      logToolCall(
        name,
        {
          description: args.description ?? "(code execution)",
          code: `${args.code.slice(0, 80)}...`,
        },
        display,
        { maxResultLength: 200 },
      );
      return JSON.stringify(result);
    }

    case "get_recipe_data": {
      const result = getRecipeData(args as { name: string });
      logToolCall(name, args, result, { maxResultLength: 200 });
      return result;
    }

    case "pool_status": {
      const status = pool.getStatus();
      const result = JSON.stringify(status, null, 2);
      logToolCall(name, args, result);
      return result;
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

/** Direct recipe lookup for the sandbox tool bridge (called from inside sandbox). */
export function handleSandboxToolCall(name: string, args: Record<string, string>): string {
  if (name === "get_recipe_data") {
    return getRecipeData(args as { name: string });
  }
  return JSON.stringify({ error: `Tool "${name}" not available in sandbox` });
}
