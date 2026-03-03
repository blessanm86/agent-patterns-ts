// ─── MCP (Model Context Protocol) — CLI Entry Point ─────────────────────────
//
// Two modes:
//   Default:   MCP mode — spawns an MCP server, discovers tools dynamically
//   --static:  Static mode — uses hardcoded tool definitions (no MCP)
//
// Usage:
//   pnpm dev:mcp            # MCP mode (dynamic tool discovery)
//   pnpm dev:mcp:static     # Static mode (hardcoded tools)

import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent, type AgentConfig, type AgentMode } from "./agent.js";
import { connectToMcpServer, type McpConnection } from "./client.js";
import { staticTools, executeStaticTool } from "./tools.js";

const mode: AgentMode = process.argv.includes("--static") ? "static" : "mcp";

async function main() {
  let config: AgentConfig;
  let mcpConnection: McpConnection | undefined;

  if (mode === "mcp") {
    // ── MCP Mode: spawn server, discover tools ───────────────────────────────
    console.log("  Connecting to MCP server...");

    mcpConnection = await connectToMcpServer("tsx", ["src/mcp/server.ts"]);

    console.log(`  Discovered ${mcpConnection.tools.length} tools via MCP:`);
    for (const tool of mcpConnection.tools) {
      const paramNames = Object.keys(tool.function.parameters.properties);
      console.log(`    - ${tool.function.name}(${paramNames.join(", ")})`);
    }
    console.log("");

    config = {
      tools: mcpConnection.tools,
      executeTool: mcpConnection.executeTool,
      serverInstructions: mcpConnection.serverInstructions,
      mode: "mcp",
    };
  } else {
    // ── Static Mode: hardcoded tools, no MCP ─────────────────────────────────
    config = {
      tools: staticTools,
      executeTool: executeStaticTool,
      mode: "static",
    };
  }

  const cli = createCLI({
    title: `MCP (Model Context Protocol) — ${mode} mode`,
    emoji: "🔌",
    goodbye: "Goodbye!",
    agentLabel: "Chef",
    welcomeLines: [
      `    Mode: ${mode === "mcp" ? "🔌 MCP (tools discovered dynamically from server)" : "📝 Static (hardcoded tool definitions)"}`,
      "",
      "  Try these prompts:",
      '    - "Find me an Italian pasta recipe"',
      '    - "Show me the full recipe for the carbonara"',
      '    - "Convert 2 cups to ml"',
      '    - "What quick recipes do you have?"',
      '    - "Convert 350 fahrenheit to celsius"',
      "",
    ],
    onMessage: async (input, history) => {
      const result = await runAgent(input, history, config);
      const s = result.stats;

      return {
        messages: result.messages,
        stats: [
          "",
          `  📊 Stats: ${s.llmCalls} LLM calls, ${s.toolCalls} tool calls, ${s.discoveredTools} tools [${s.mode} mode]`,
        ],
      };
    },
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  process.on("SIGINT", async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
    process.exit(0);
  });

  cli.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
