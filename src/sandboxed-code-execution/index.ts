// ─── Recipe Calculator — Sandboxed Code Execution ─────────────────────────────
//
// CLI entry point. Initializes the sandbox pool, creates a conversation,
// and runs the ReAct agent with sandbox lifecycle management.

import { randomUUID } from "node:crypto";
import { createCLI } from "../shared/cli.js";
import { TokenProxy } from "./token-proxy.js";
import { NodeChildProcessProvider, SandboxPool } from "./sandbox-pool.js";
import { handleSandboxToolCall } from "./tools.js";
import { runAgent } from "./agent.js";

// ─── Initialize ───────────────────────────────────────────────────────────────

const tokenProxy = new TokenProxy();
const provider = new NodeChildProcessProvider();
const pool = new SandboxPool(provider, tokenProxy);
const conversationId = randomUUID();

// Register tool bridge — sandbox code can call get_recipe_data via callTool()
pool.setToolHandler(async (name, args) => {
  return handleSandboxToolCall(name, args);
});

// Pre-warm the pool before accepting user input
await pool.initialize();

// ─── CLI ──────────────────────────────────────────────────────────────────────

const cli = createCLI({
  title: "Recipe Calculator — Sandboxed Code Execution",
  emoji: "🧪",
  goodbye: "Goodbye! 🧪",
  welcomeLines: [
    "💡  The agent writes JavaScript code to solve cooking calculations.",
    "    Code runs in sandboxed child processes with limited globals.",
    "",
    '    Try: "Scale chicken tikka masala from 4 to 10 servings"',
    '    Try: "Compare calories between pad thai and caesar salad"',
    '    Try: "Convert 600g of chicken breast to ounces"',
    "",
    "    Commands: /pool (status) | /kill (kill sandbox) | /reset (clear history)",
  ],
  async onMessage(input, history) {
    const { messages, stats } = await runAgent(input, history, pool, conversationId);

    const affinityLabel = stats.affinityReused ? "affinity reuse" : "new binding";
    return {
      messages,
      stats: [
        `\n  📊 Stats: ${stats.llmCalls} LLM calls, ${stats.toolCalls} tool calls, ${stats.codeExecutions} code executions`,
        `  🔒 Sandbox: ${stats.sandboxId.slice(0, 8)}… (${affinityLabel})`,
      ],
    };
  },
  onCommand(command, _history) {
    if (command === "/pool") {
      const status = pool.getStatus();
      console.log("\n  📦 Pool Status:");
      console.log(
        `     Total: ${status.total} | Idle: ${status.idle} | Busy: ${status.busy} | Booting: ${status.booting}`,
      );
      console.log(
        `     Affinity bindings: ${status.affinityBindings} | Active tokens: ${status.activeTokens}`,
      );
      return true;
    }

    if (command === "/kill") {
      const sandboxId = pool.getAffinitySandbox(conversationId);
      if (sandboxId) {
        console.log(
          `\n  💀 Killing sandbox ${sandboxId.slice(0, 8)}… to demonstrate eviction + replenishment`,
        );
        pool.killSandbox(sandboxId);
      } else {
        console.log("\n  No sandbox currently bound to this conversation.");
      }
      return true;
    }

    if (command === "/reset") {
      console.log("\n  🔄 Conversation history cleared.");
      return { handled: true, newHistory: [] };
    }

    return false;
  },
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  await pool.shutdown();
  process.exit(0);
});

cli.start();
