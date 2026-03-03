// ─── MCP Server ──────────────────────────────────────────────────────────────
//
// An MCP server that exposes recipe tools over stdio transport.
// Run standalone: `tsx src/mcp/server.ts`
// The client (client.ts) spawns this as a subprocess and connects via stdio.
//
// CRITICAL: No console.log() allowed — stdout is the JSON-RPC transport.
// Use console.error() for any debug output.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchRecipes, getRecipe, convertUnits } from "./data.js";

const server = new McpServer(
  {
    name: "recipe-server",
    version: "1.0.0",
  },
  {
    instructions:
      "You have access to a recipe database with dishes from multiple cuisines. You can search for recipes by keyword or cuisine, get full recipe details, and convert cooking units.",
  },
);

// ─── Tool: search_recipes ────────────────────────────────────────────────────

server.tool(
  "search_recipes",
  "Search for recipes by keyword (name, ingredient, tag) and optionally filter by cuisine. Returns recipe summaries with id, name, cuisine, prep time, servings, and tags.",
  {
    query: z
      .string()
      .describe("Search term — matches recipe names, ingredients, tags, and cuisines"),
    cuisine: z
      .string()
      .optional()
      .describe(
        "Optional cuisine filter (e.g. Italian, Mexican, Japanese, Indian, American, Thai)",
      ),
  },
  async ({ query, cuisine }) => ({
    content: [{ type: "text", text: searchRecipes(query, cuisine) }],
  }),
);

// ─── Tool: get_recipe ────────────────────────────────────────────────────────

server.tool(
  "get_recipe",
  "Get the full details of a recipe by its ID, including ingredients and step-by-step instructions.",
  {
    recipe_id: z.string().describe("The recipe ID (e.g. r1, r2, r3)"),
  },
  async ({ recipe_id }) => ({
    content: [{ type: "text", text: getRecipe(recipe_id) }],
  }),
);

// ─── Tool: convert_units ─────────────────────────────────────────────────────

server.tool(
  "convert_units",
  "Convert between cooking measurement units. Supports: cups, ml, tbsp, tsp, oz, g, kg, fahrenheit, celsius.",
  {
    value: z.number().describe("The numeric value to convert"),
    from_unit: z
      .string()
      .describe("Source unit (e.g. cups, ml, tbsp, tsp, oz, g, kg, fahrenheit, celsius)"),
    to_unit: z
      .string()
      .describe("Target unit (e.g. cups, ml, tbsp, tsp, oz, g, kg, fahrenheit, celsius)"),
  },
  async ({ value, from_unit, to_unit }) => ({
    content: [{ type: "text", text: convertUnits(value, from_unit, to_unit) }],
  }),
);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Recipe MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
