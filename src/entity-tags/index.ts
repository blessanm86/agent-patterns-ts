import * as readline from "readline";
import { MODEL } from "../shared/config.js";
import { runAgent } from "./agent.js";
import { formatEntityStats } from "./display.js";
import type { Message } from "../shared/types.js";
import type { TagMode } from "./types.js";

// ─── Mode Selection ─────────────────────────────────────────────────────────
//
// --plain: no tag instructions, baseline comparison
// default: tagged mode — system prompt teaches entity tag format

const mode: TagMode = process.argv.includes("--plain") ? "plain" : "tagged";
const modeName =
  mode === "tagged" ? "TAGGED (entity tags in output)" : "PLAIN (no tag instructions)";

// ─── CLI Chat Loop ──────────────────────────────────────────────────────────

const dividerWidth = 50;
let rawHistory: Message[] = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printDivider() {
  console.log("\n" + "\u2500".repeat(dividerWidth));
}

function printWelcome() {
  console.log(`\n\u{1F3F7}\uFE0F  NovaMart Support — Entity Tags Pattern`);
  console.log(`    Powered by Ollama + ${MODEL}`);
  console.log('    Type "exit" to quit\n');
  console.log(`    Mode: ${modeName}`);
  console.log("");

  if (mode === "tagged") {
    console.log("    Running in TAGGED mode \u2014 entities rendered as colored badges.");
    console.log("    Compare with: pnpm dev:entity-tags:plain");
  } else {
    console.log("    Running in PLAIN mode \u2014 no entity tag instructions.");
    console.log("    Compare with: pnpm dev:entity-tags");
  }

  console.log("");
  console.log("    Try these prompts:");
  console.log('    "Look up Alice Johnson"');
  console.log('    "What\'s in order ORD-5001?"');
  console.log('    "Show me electronics products"');
  console.log('    "What categories do you have?"');
  console.log("");
}

async function chat() {
  printDivider();
  process.stdout.write("You: ");

  rl.once("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return chat();
    if (trimmed.toLowerCase() === "exit") {
      console.log("\nGoodbye! \u{1F3F7}\uFE0F\n");
      rl.close();
      return;
    }

    try {
      const result = await runAgent(trimmed, rawHistory, mode);
      rawHistory = result.rawHistory;

      // Display the response
      printDivider();
      if (mode === "tagged") {
        // Show rendered content with ANSI badges
        console.log(`\nAgent: ${result.displayContent}`);
      } else {
        // Plain mode: show raw content
        const lastAssistant = [...result.rawHistory].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          console.log(`\nAgent: ${lastAssistant.content}`);
        }
      }

      // Show entity stats panel in tagged mode
      if (result.entityStats) {
        for (const line of formatEntityStats(result.entityStats)) {
          console.log(line);
        }
      }
    } catch (err) {
      const error = err as Error;
      if (error.message?.includes("ECONNREFUSED")) {
        console.error("\n\u274C Could not connect to Ollama.");
        console.error("   Make sure Ollama is running: ollama serve");
        console.error(`   And that you have the model pulled: ollama pull ${MODEL}\n`);
        rl.close();
        return;
      }
      console.error("\n\u274C Error:", error.message);
    }

    chat();
  });
}

printWelcome();
chat();
