import * as readline from "readline";
import { runAgent } from "./agent.js";
import type { Message } from "../shared/types.js";

// ─── CLI Chat Loop — Working Version ─────────────────────────────────────────
//
// The history array lives here and grows across every turn.
// Each call to runAgent receives the full history and returns an updated copy.
// This is the CORRECT way to maintain conversation memory.

let history: Message[] = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printDivider() {
  console.log("\n" + "─".repeat(50));
}

function printWelcome() {
  console.log("\n  Recipe Assistant — with memory");
  console.log("  Powered by Ollama + " + (process.env.MODEL ?? "qwen2.5:7b"));
  console.log('  Type "exit" to quit\n');
  console.log("  Try this sequence to see memory in action:");
  console.log("    1. \"I'm allergic to nuts. What's a good snack?\"");
  console.log('    2. "What about something chocolatey?"');
  console.log('    3. "What am I allergic to?"');
}

function printResponse(history: Message[]) {
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) {
    printDivider();
    console.log(`\nAssistant: ${lastAssistant.content}`);
  }
}

function quit() {
  console.log("\nGoodbye!\n");
  rl.close();
}

function handleError(err: unknown): boolean {
  const error = err as Error;
  if (error.message?.includes("ECONNREFUSED")) {
    console.error("\n  Could not connect to Ollama.");
    console.error("  Make sure Ollama is running: ollama serve");
    console.error(
      `  And that you have the model pulled: ollama pull ${process.env.MODEL ?? "qwen2.5:7b"}\n`,
    );
    rl.close();
    return false;
  }
  console.error("\n  Error:", error.message);
  return true;
}

async function chat() {
  printDivider();
  process.stdout.write("You: ");

  rl.once("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return chat();
    if (trimmed.toLowerCase() === "exit") return quit();

    try {
      // history grows: pass it in, get the updated version back
      history = await runAgent(trimmed, history);
      printResponse(history);
    } catch (err) {
      if (!handleError(err)) return;
    }

    chat();
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

printWelcome();
chat();
