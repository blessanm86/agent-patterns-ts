// ─── MCP Tool Call Evals ─────────────────────────────────────────────────────
//
// Agent trajectory evals — verify the agent calls the right MCP tools
// for different queries.

import { evalite, createScorer } from "evalite";
import { runAgent, type AgentConfig, type AgentStats } from "../agent.js";
import { connectToMcpServer, type McpConnection } from "../client.js";
import { extractToolCallNames } from "../../react/eval-utils.js";
import type { Message } from "../../shared/types.js";

// Helper: connect once, build config
let config: AgentConfig | undefined;
let connection: McpConnection | undefined;

async function getConfig(): Promise<AgentConfig> {
  if (!config) {
    connection = await connectToMcpServer("tsx", ["src/mcp/server.ts"]);
    config = {
      tools: connection.tools,
      executeTool: connection.executeTool,
      serverInstructions: connection.serverInstructions,
      mode: "mcp",
    };
  }
  return config;
}

type TrajectoryResult = { toolNames: string[]; stats: AgentStats; messages: Message[] };

// ─── Recipe Search → Get Recipe ──────────────────────────────────────────────

evalite("MCP agent — Italian pasta recipe triggers search then get_recipe", {
  data: async () => [{ input: "Find me an Italian pasta recipe and show me the full details" }],
  task: async (input): Promise<TrajectoryResult> => {
    const cfg = await getConfig();
    const result = await runAgent(input, [], cfg);
    return {
      toolNames: extractToolCallNames(result.messages),
      stats: result.stats,
      messages: result.messages,
    };
  },
  scorers: [
    createScorer<string, TrajectoryResult>({
      name: "called search_recipes",
      scorer: ({ output }) => (output.toolNames.includes("search_recipes") ? 1 : 0),
    }),
    createScorer<string, TrajectoryResult>({
      name: "called get_recipe after search",
      scorer: ({ output }) => {
        const searchIdx = output.toolNames.indexOf("search_recipes");
        const getIdx = output.toolNames.indexOf("get_recipe");
        return searchIdx !== -1 && getIdx !== -1 && getIdx > searchIdx ? 1 : 0;
      },
    }),
  ],
});

// ─── Unit Conversion Only ────────────────────────────────────────────────────

evalite("MCP agent — unit conversion does not trigger recipe tools", {
  data: async () => [{ input: "Convert 2 cups to ml" }],
  task: async (input): Promise<TrajectoryResult> => {
    const cfg = await getConfig();
    const result = await runAgent(input, [], cfg);
    return {
      toolNames: extractToolCallNames(result.messages),
      stats: result.stats,
      messages: result.messages,
    };
  },
  scorers: [
    createScorer<string, TrajectoryResult>({
      name: "called convert_units",
      scorer: ({ output }) => (output.toolNames.includes("convert_units") ? 1 : 0),
    }),
    createScorer<string, TrajectoryResult>({
      name: "did not call search_recipes",
      scorer: ({ output }) => (output.toolNames.includes("search_recipes") ? 0 : 1),
    }),
  ],
});
