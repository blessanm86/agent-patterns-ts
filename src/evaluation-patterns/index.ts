import * as readline from "readline";
import type { Message } from "../shared/types.js";
import { runHotelAgent } from "./agent.js";
import { lastAssistantMessage } from "../shared/eval-utils.js";

// ─── Minimal CLI ──────────────────────────────────────────────────────────────
//
// A thin readline loop over the testable agent from agent.ts.
// The interesting code is in evals/ — run `pnpm eval:watch` to explore it.

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function printWelcome() {
  console.log("\n🏨  Evaluation Patterns — Hotel Agent");
  console.log("    Agent: src/evaluation-patterns/agent.ts");
  console.log("    Evals: pnpm eval:watch  →  localhost:3006\n");
  console.log('  Try: "Book a double room for Alice Chen, June 1-4, 2026"');
  console.log("  Type 'exit' to quit\n");
}

async function chat(history: Message[] = []) {
  process.stdout.write("\nYou: ");

  rl.once("line", async (line) => {
    const input = line.trim();
    if (!input) return chat(history);

    if (input.toLowerCase() === "exit") {
      console.log("\nGoodbye!\n");
      rl.close();
      return;
    }

    try {
      const updated = await runHotelAgent(input, history);
      console.log(`\nAssistant: ${lastAssistantMessage(updated)}`);
      chat(updated);
    } catch (err) {
      const error = err as Error;
      if (error.message?.includes("ECONNREFUSED")) {
        console.error("\n❌ Could not connect to Ollama.");
        console.error("   Make sure Ollama is running: ollama serve\n");
        rl.close();
        return;
      }
      console.error("\n❌ Error:", error.message);
      chat(history);
    }
  });
}

printWelcome();
chat();
