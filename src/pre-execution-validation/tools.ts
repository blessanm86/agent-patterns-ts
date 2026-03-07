// ─── Tool Definitions + Implementations ──────────────────────────────────────
//
// Four tools for the recipe workspace agent:
//   1. list_recipes — list all recipe files in the workspace
//   2. read_recipe — read a recipe file's contents
//   3. edit_recipe — edit/create a recipe (shadow-validated in shadow mode)
//   4. delete_recipe — remove a recipe file
//
// In "shadow" mode, edit_recipe runs the full shadow workspace lifecycle:
//   clone → apply → validate → promote/discard
// In "direct" mode, edits are applied immediately with no validation.

import type { ToolDefinition } from "../shared/types.js";
import { logToolCall } from "../shared/logging.js";
import { shadowEdit, type Workspace, type ShadowEditResult } from "./shadow.js";

// ─── Agent Mode ──────────────────────────────────────────────────────────────

export type AgentMode = "shadow" | "direct";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_recipes",
      description:
        "List all recipe files currently in the workspace. Returns filenames and a brief summary of each recipe.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_recipe",
      description:
        "Read the full contents of a recipe file. Returns the raw JSON content of the recipe.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The recipe filename to read (e.g. 'pad-thai.json')",
          },
        },
        required: ["filename"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_recipe",
      description: `Create or update a recipe file with new JSON content.

The recipe JSON must have this exact structure:
{
  "name": "string (non-empty)",
  "category": "breakfast" | "lunch" | "dinner" | "dessert" | "snack",
  "difficulty": "easy" | "medium" | "hard",
  "servings": integer (1-100),
  "prepTimeMinutes": integer (1-480),
  "ingredients": [{ "name": "string", "quantity": positive number, "unit": "g"|"kg"|"ml"|"l"|"cup"|"tbsp"|"tsp"|"whole"|"pinch" }],
  "instructions": ["step 1", "step 2", ...] (1-20 steps),
  "nutrition": { "caloriesPerServing": 0-5000, "proteinGrams": 0-500, "carbsGrams": 0-500, "fatGrams": 0-500 }
}

IMPORTANT: Calorie count must roughly match macros (protein*4 + carbs*4 + fat*9). Instructions should reference ingredient names. No duplicate ingredients.

If the edit has errors, you will receive specific diagnostics. Fix ALL reported issues and try again.`,
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The recipe filename to create or update (e.g. 'pad-thai.json')",
          },
          content: {
            type: "string",
            description: "The complete recipe JSON string",
          },
        },
        required: ["filename", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_recipe",
      description: "Delete a recipe file from the workspace.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The recipe filename to delete (e.g. 'pad-thai.json')",
          },
        },
        required: ["filename"],
      },
    },
  },
];

// ─── Tool Implementations ────────────────────────────────────────────────────

function listRecipes(workspace: Workspace): string {
  if (workspace.files.size === 0) {
    return JSON.stringify({ recipes: [], total: 0, note: "No recipes in workspace yet." });
  }

  const recipes: Array<{ filename: string; name: string; category: string }> = [];
  for (const [filename, content] of workspace.files) {
    try {
      const parsed = JSON.parse(content);
      recipes.push({
        filename,
        name: parsed.name ?? "(unnamed)",
        category: parsed.category ?? "(unknown)",
      });
    } catch {
      recipes.push({ filename, name: "(invalid JSON)", category: "(unknown)" });
    }
  }

  return JSON.stringify({ recipes, total: recipes.length });
}

function readRecipe(workspace: Workspace, args: { filename: string }): string {
  const content = workspace.files.get(args.filename);
  if (!content) {
    const available = Array.from(workspace.files.keys()).join(", ");
    return JSON.stringify({
      error: `File "${args.filename}" not found. Available: ${available || "(none)"}`,
    });
  }
  return content;
}

function editRecipeShadow(
  workspace: Workspace,
  args: { filename: string; content: string },
): string {
  const result: ShadowEditResult = shadowEdit(workspace, args.filename, args.content);

  if (result.success) {
    return JSON.stringify({
      status: "promoted",
      message: `Edit validated and applied to workspace via ${result.shadowId}.`,
      diagnostics: [],
    });
  }

  // Return diagnostics so the agent can self-correct
  return JSON.stringify({
    status: "rejected",
    message: `Edit failed validation in ${result.shadowId}. Fix these errors and try again:`,
    diagnostics: result.diagnostics.map((d) => ({
      layer: d.layer,
      location: d.path,
      error: d.message,
    })),
  });
}

function editRecipeDirect(
  workspace: Workspace,
  args: { filename: string; content: string },
): string {
  workspace.files.set(args.filename, args.content);
  return JSON.stringify({
    status: "applied",
    message: `Edit applied directly to workspace (no validation).`,
  });
}

function deleteRecipe(workspace: Workspace, args: { filename: string }): string {
  if (!workspace.files.has(args.filename)) {
    return JSON.stringify({ error: `File "${args.filename}" not found.` });
  }
  workspace.files.delete(args.filename);
  return JSON.stringify({ status: "deleted", message: `Deleted ${args.filename}.` });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export interface ToolStats {
  shadowValidations: number;
  validationPasses: number;
  validationFailures: number;
  promotions: number;
}

export function executeTool(
  name: string,
  args: Record<string, string>,
  workspace: Workspace,
  mode: AgentMode,
  stats: ToolStats,
): string {
  switch (name) {
    case "list_recipes": {
      const result = listRecipes(workspace);
      logToolCall(name, {}, result, { maxResultLength: 200 });
      return result;
    }

    case "read_recipe": {
      const result = readRecipe(workspace, args as { filename: string });
      logToolCall(name, args, result, { maxResultLength: 200 });
      return result;
    }

    case "edit_recipe": {
      if (mode === "shadow") {
        stats.shadowValidations++;
        const result = editRecipeShadow(workspace, args as { filename: string; content: string });
        const parsed = JSON.parse(result);
        if (parsed.status === "promoted") {
          stats.validationPasses++;
          stats.promotions++;
        } else {
          stats.validationFailures++;
        }
        logToolCall(name, { filename: args.filename, content: "(recipe JSON)" }, result, {
          maxResultLength: 300,
        });
        return result;
      }
      const result = editRecipeDirect(workspace, args as { filename: string; content: string });
      logToolCall(name, { filename: args.filename, content: "(recipe JSON)" }, result);
      return result;
    }

    case "delete_recipe": {
      const result = deleteRecipe(workspace, args as { filename: string });
      logToolCall(name, args, result);
      return result;
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
