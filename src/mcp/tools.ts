// ─── Static Tool Definitions (no MCP) ────────────────────────────────────────
//
// The same 3 recipe tools as the MCP server, but hardcoded as ToolDefinitions.
// This is the baseline for comparison — the "before MCP" approach where every
// tool is statically defined and directly imported by the agent.

import type { ToolDefinition } from "../shared/types.js";
import { searchRecipes, getRecipe, convertUnits } from "./data.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const staticTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_recipes",
      description:
        "Search for recipes by keyword (name, ingredient, tag) and optionally filter by cuisine. Returns recipe summaries with id, name, cuisine, prep time, servings, and tags.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term — matches recipe names, ingredients, tags, and cuisines",
          },
          cuisine: {
            type: "string",
            description:
              "Optional cuisine filter (e.g. Italian, Mexican, Japanese, Indian, American, Thai)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recipe",
      description:
        "Get the full details of a recipe by its ID, including ingredients and step-by-step instructions.",
      parameters: {
        type: "object",
        properties: {
          recipe_id: {
            type: "string",
            description: "The recipe ID (e.g. r1, r2, r3)",
          },
        },
        required: ["recipe_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "convert_units",
      description:
        "Convert between cooking measurement units. Supports: cups, ml, tbsp, tsp, oz, g, kg, fahrenheit, celsius.",
      parameters: {
        type: "object",
        properties: {
          value: {
            type: "string",
            description: "The numeric value to convert",
          },
          from_unit: {
            type: "string",
            description: "Source unit (e.g. cups, ml, tbsp, tsp, oz, g, kg, fahrenheit, celsius)",
          },
          to_unit: {
            type: "string",
            description: "Target unit (e.g. cups, ml, tbsp, tsp, oz, g, kg, fahrenheit, celsius)",
          },
        },
        required: ["value", "from_unit", "to_unit"],
      },
    },
  },
];

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeStaticTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_recipes":
      return searchRecipes(args.query, args.cuisine);
    case "get_recipe":
      return getRecipe(args.recipe_id);
    case "convert_units":
      return convertUnits(Number(args.value), args.from_unit, args.to_unit);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
