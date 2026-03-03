// ─── MCP Discovery Evals ─────────────────────────────────────────────────────
//
// Tests that the MCP client correctly discovers tools from the server and
// translates their schemas into the repo's ToolDefinition format.

import { evalite, createScorer } from "evalite";
import { connectToMcpServer, type McpConnection } from "../client.js";
import type { ToolDefinition } from "../../shared/types.js";

// Helper: connect once, cache connection for all evals in this file
let connection: McpConnection | undefined;

async function getConnection(): Promise<McpConnection> {
  if (!connection) {
    connection = await connectToMcpServer("tsx", ["src/mcp/server.ts"]);
  }
  return connection;
}

// ─── Tool Discovery ──────────────────────────────────────────────────────────

evalite("MCP discovery — discovers all 3 tools", {
  data: async () => [{ input: "discover" }],
  task: async () => {
    const conn = await getConnection();
    return conn.tools;
  },
  scorers: [
    createScorer<string, ToolDefinition[]>({
      name: "finds exactly 3 tools",
      scorer: ({ output }) => (output.length === 3 ? 1 : 0),
    }),
    createScorer<string, ToolDefinition[]>({
      name: "includes search_recipes",
      scorer: ({ output }) => (output.some((t) => t.function.name === "search_recipes") ? 1 : 0),
    }),
    createScorer<string, ToolDefinition[]>({
      name: "includes get_recipe",
      scorer: ({ output }) => (output.some((t) => t.function.name === "get_recipe") ? 1 : 0),
    }),
    createScorer<string, ToolDefinition[]>({
      name: "includes convert_units",
      scorer: ({ output }) => (output.some((t) => t.function.name === "convert_units") ? 1 : 0),
    }),
  ],
});

// ─── Schema Translation ─────────────────────────────────────────────────────

evalite("MCP discovery — schema translation preserves parameters", {
  data: async () => [{ input: "schema" }],
  task: async () => {
    const conn = await getConnection();
    return conn.tools;
  },
  scorers: [
    createScorer<string, ToolDefinition[]>({
      name: "search_recipes has required 'query' param",
      scorer: ({ output }) => {
        const tool = output.find((t) => t.function.name === "search_recipes");
        if (!tool) return 0;
        return tool.function.parameters.required.includes("query") &&
          "query" in tool.function.parameters.properties
          ? 1
          : 0;
      },
    }),
    createScorer<string, ToolDefinition[]>({
      name: "search_recipes has optional 'cuisine' param",
      scorer: ({ output }) => {
        const tool = output.find((t) => t.function.name === "search_recipes");
        if (!tool) return 0;
        return "cuisine" in tool.function.parameters.properties &&
          !tool.function.parameters.required.includes("cuisine")
          ? 1
          : 0;
      },
    }),
    createScorer<string, ToolDefinition[]>({
      name: "convert_units has 3 required params",
      scorer: ({ output }) => {
        const tool = output.find((t) => t.function.name === "convert_units");
        if (!tool) return 0;
        const req = tool.function.parameters.required;
        return req.includes("value") && req.includes("from_unit") && req.includes("to_unit")
          ? 1
          : 0;
      },
    }),
    createScorer<string, ToolDefinition[]>({
      name: "all tools have descriptions",
      scorer: ({ output }) => (output.every((t) => t.function.description.length > 0) ? 1 : 0),
    }),
  ],
});

// ─── Server Instructions ────────────────────────────────────────────────────

evalite("MCP discovery — server provides instructions", {
  data: async () => [{ input: "instructions" }],
  task: async () => {
    const conn = await getConnection();
    return conn.serverInstructions ?? "";
  },
  scorers: [
    createScorer<string, string>({
      name: "instructions are non-empty",
      scorer: ({ output }) => (output.length > 0 ? 1 : 0),
    }),
    createScorer<string, string>({
      name: "instructions mention recipes",
      scorer: ({ output }) => (output.toLowerCase().includes("recipe") ? 1 : 0),
    }),
  ],
});
