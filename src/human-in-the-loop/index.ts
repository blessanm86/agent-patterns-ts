import "dotenv/config";
import * as readline from "readline";
import { runHITLAgent } from "./agent.js";
import { resetTaskBoard } from "./tools.js";
import { AuditTrail, type ApprovalMode } from "./approval.js";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";

// ─── Custom CLI Loop ─────────────────────────────────────────────────────────
//
// We can't use createCLI() here because the approval prompts need the same
// readline instance as the main chat loop. If we created a second readline,
// the two would fight over stdin.

let history: Message[] = [];
let mode: ApprovalMode = "balanced";
const auditTrail = new AuditTrail();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printDivider() {
  console.log("\n" + "─".repeat(60));
}

function printWelcome() {
  console.log("\n🔒  Human-in-the-Loop Demo — Team Alpha Sprint Board");
  console.log(`    Powered by Ollama + ${MODEL}`);
  console.log('    Type "exit" to quit\n');
  console.log("📋  Approval modes (controls which tools need human approval):");
  console.log("    /auto     — only critical actions need approval");
  console.log("    /balanced — high + critical need approval (default)");
  console.log("    /strict   — everything except reads needs approval");
  console.log("");
  console.log("🧪  Other commands:");
  console.log("    /audit    — show the approval audit trail");
  console.log("    /reset    — restore task board + clear history");
  console.log("");
  console.log(`    Current mode: ${mode}`);
  console.log("");
  console.log("💡  Try these:");
  console.log('    "Show me all tasks"');
  console.log('    "Delete task TASK-3"');
  console.log('    "Delete all done tasks"');
  console.log('    Then switch to /strict and try "Create a task for login page"');
  console.log("");
}

function printStats(result: {
  iterations: number;
  toolCalls: number;
  autoApproved: number;
  humanApproved: number;
  denied: number;
  modified: number;
}) {
  const parts = [
    `Steps: ${result.iterations}`,
    `Tools: ${result.toolCalls}`,
    `Auto: ${result.autoApproved}`,
    `Approved: ${result.humanApproved}`,
    `Denied: ${result.denied}`,
  ];
  if (result.modified > 0) parts.push(`Modified: ${result.modified}`);
  console.log(`\n  📊 ${parts.join("  |  ")}  |  Mode: ${mode}`);
}

function handleCommand(cmd: string): boolean {
  switch (cmd) {
    case "/auto":
      mode = "auto";
      console.log("  ⚡ Mode: AUTO — only critical actions need approval");
      return true;

    case "/balanced":
      mode = "balanced";
      console.log("  ⚖️  Mode: BALANCED — high + critical actions need approval");
      return true;

    case "/strict":
      mode = "strict";
      console.log("  🔒 Mode: STRICT — all non-read actions need approval");
      return true;

    case "/audit": {
      console.log("\n  📜 Audit Trail:");
      const lines = auditTrail.toDisplayLines();
      for (const line of lines) {
        console.log(line);
      }
      const summary = auditTrail.getSummary();
      if (summary.total > 0) {
        console.log(
          `\n  Total: ${summary.total} | Auto: ${summary.autoApproved} | Human: ${summary.humanApproved} | Denied: ${summary.denied} | Modified: ${summary.modified}`,
        );
      }
      return true;
    }

    case "/reset":
      resetTaskBoard();
      history = [];
      auditTrail.clear();
      console.log("  🔄 Reset: task board restored, history cleared, audit trail cleared");
      return true;

    default:
      return false;
  }
}

function chat() {
  printDivider();
  process.stdout.write("You: ");

  rl.once("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return chat();
    if (trimmed.toLowerCase() === "exit") {
      console.log("\nGoodbye! 🔒\n");
      rl.close();
      return;
    }

    // Slash commands
    if (trimmed.startsWith("/")) {
      if (!handleCommand(trimmed)) {
        console.log(`  Unknown command: ${trimmed}`);
      }
      return chat();
    }

    try {
      const result = await runHITLAgent(trimmed, history, mode, auditTrail, rl);
      history = result.messages;

      // Print the last assistant message
      const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) {
        printDivider();
        console.log(`\nAgent: ${lastAssistant.content}`);
      }

      printStats(result);
    } catch (err) {
      const error = err as Error;
      if (error.message?.includes("ECONNREFUSED")) {
        console.error("\n❌ Could not connect to Ollama.");
        console.error("   Make sure Ollama is running: ollama serve");
        console.error(`   And that you have the model pulled: ollama pull ${MODEL}\n`);
        rl.close();
        return;
      }
      console.error("\n❌ Error:", error.message);
    }

    chat();
  });
}

printWelcome();
chat();
