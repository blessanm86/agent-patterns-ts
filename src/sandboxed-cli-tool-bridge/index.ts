// ─── Sandboxed CLI Tool Bridge — Entry Point ────────────────────────────────
//
// Demonstrates tools exposed as a CLI binary ("tools list/describe/invoke")
// communicating via newline-delimited JSON-RPC over stdin/stdout — the same
// transport pattern MCP uses, built from scratch to teach the protocol.

import { createCLI } from "../shared/cli.js";
import { ToolRegistry, registerAllTools } from "./tools.js";
import { ToolBridge } from "./tool-bridge.js";
import { runAgent } from "./agent.js";

// ─── Initialize ──────────────────────────────────────────────────────────────

const registry = new ToolRegistry();
registerAllTools(registry);

const bridge = new ToolBridge(registry);
await bridge.start();

// ─── CLI ─────────────────────────────────────────────────────────────────────

const cli = createCLI({
  title: "Sandboxed CLI Tool Bridge",
  emoji: "🔌",
  goodbye: "Goodbye! 🔌",
  welcomeLines: [
    "💡  The agent uses execute_shell to run 'tools' commands in a sandbox.",
    "    Watch the tools list → describe → invoke flow in the console.",
    "",
    '    Try: "What\'s the weather in Paris?"',
    '    Try: "Find Italian restaurants in New York"',
    '    Try: "Calculate sqrt(144) + 25"',
    '    Try: "Search for TypeScript files in the src directory"',
    "",
    "    Commands: /session (show session info) | /reset (clear history + session)",
  ],
  async onMessage(input, history) {
    const { messages, stats } = await runAgent(input, history, bridge);

    return {
      messages,
      stats: [
        `\n  📊 Stats: ${stats.llmCalls} LLM calls, ${stats.toolCalls} tool calls, ${stats.shellCommands} shell commands`,
      ],
    };
  },
  onCommand(command, _history) {
    if (command === "/session") {
      const info = bridge.getSessionInfo();
      console.log("\n  🔒 Session Info:");
      console.log(`     Token: ${info.token}`);
      console.log(
        `     Described tools: ${info.describedTools.length > 0 ? info.describedTools.join(", ") : "(none)"}`,
      );
      console.log(`     Uptime: ${Math.round(info.uptime / 1000)}s`);
      return true;
    }

    if (command === "/reset") {
      bridge.resetSession();
      console.log("\n  🔄 Conversation history and session cleared.");
      return { handled: true, newHistory: [] };
    }

    return false;
  },
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

process.on("SIGINT", () => {
  bridge.shutdown();
  process.exit(0);
});

cli.start();
