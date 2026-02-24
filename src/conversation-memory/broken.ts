import * as readline from "readline";
import { runAgent } from "./agent.js";

// ─── CLI Chat Loop — Broken Version ──────────────────────────────────────────
//
// This file is intentionally broken to demonstrate what happens without memory.
// Spot the bug: history is never stored or passed forward.
// Every turn starts fresh — the agent has amnesia.

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printDivider() {
  console.log("\n" + "─".repeat(50));
}

function printWelcome() {
  console.log("\n  Recipe Assistant — WITHOUT memory (broken)");
  console.log("  Powered by Ollama + " + (process.env.MODEL ?? "qwen2.5:7b"));
  console.log('  Type "exit" to quit\n');
  console.log("  Try this sequence to see the amnesia:");
  console.log("    1. \"I'm allergic to nuts. What's a good snack?\"");
  console.log('    2. "What about something chocolatey?"');
  console.log('    3. "What am I allergic to?"');
}

function printResponse(messages: { role: string; content: string }[]) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
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
      // BUG: passing [] instead of the accumulated history.
      // The agent never sees prior messages — every turn is a blank slate.
      const messages = await runAgent(trimmed, []);
      printResponse(messages);
    } catch (err) {
      if (!handleError(err)) return;
    }

    chat();
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

printWelcome();
chat();
