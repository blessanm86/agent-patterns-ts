import * as readline from "readline";
import { runAgentWithRecovery, MAX_TOOL_RETRIES } from "./agent.js";
import { resetMockData } from "./tools.js";
import type { Message } from "../shared/types.js";
import type { RecoveryMode } from "./agent.js";

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────
//
// Demonstrates three error recovery strategies side-by-side.
// Use /crash, /blind, /corrective to switch modes mid-conversation.
// Use /reset to restore mock room data between experiments.

let history: Message[] = [];
let mode: RecoveryMode = "corrective";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printDivider() {
  console.log("\n" + "─".repeat(60));
}

function modeLabel(m: RecoveryMode): string {
  return {
    crash: "💥 crash",
    blind: "🔁 blind",
    corrective: "💡 corrective",
  }[m];
}

function printWelcome() {
  console.log("\n🏨  The Grand TypeScript Hotel — Error Recovery Demo");
  console.log("    Powered by Ollama + " + (process.env.MODEL ?? "qwen2.5:7b"));
  console.log(`    Current mode: ${modeLabel(mode)} (max retries: ${MAX_TOOL_RETRIES})\n`);

  console.log("  Commands:");
  console.log("    /corrective  — corrective mode (default): error + specific hint");
  console.log("    /blind       — blind mode: raw error only, model must guess");
  console.log("    /crash       — crash mode: stop immediately on any error");
  console.log("    /reset       — restore room availability (rooms booked in-session)");
  console.log("    exit         — quit\n");

  console.log("  Prompts that trigger errors:");
  console.log('    Date format error:   "Book a room checking in next friday to March 10"');
  console.log('    Unknown room type:   "I want a premium room for March 1 to March 5"');
  console.log('    Missing guest name:  "Book a double room from 2026-03-01 to 2026-03-05"');
  console.log(
    '    Normal flow:         "Book a double room from 2026-03-01 to 2026-03-05 for Jane Smith"',
  );
}

function printResponse(messages: Message[]) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) {
    printDivider();
    console.log(`\nAgent: ${lastAssistant.content}`);
  }
}

function printStats(
  toolStats: { calls: number; errors: number; recovered: number; failed: number },
  currentMode: RecoveryMode,
) {
  const { calls, errors, recovered, failed } = toolStats;
  if (calls > 0) {
    console.log(
      `\n  📊 Tool calls: ${calls}  |  Errors: ${errors}  |  Recovered: ${recovered}  |  Failed: ${failed}  |  Mode: ${currentMode}`,
    );
  }
}

function handleCommand(input: string): boolean {
  switch (input) {
    case "/corrective":
      mode = "corrective";
      console.log(`\nMode: ${modeLabel(mode)} — errors returned with specific fix hints`);
      return true;
    case "/blind":
      mode = "blind";
      console.log(`\nMode: ${modeLabel(mode)} — raw error only, model guesses the fix`);
      return true;
    case "/crash":
      mode = "crash";
      console.log(`\nMode: ${modeLabel(mode)} — agent stops immediately on any error`);
      return true;
    case "/reset":
      resetMockData();
      history = [];
      console.log("\n✅ Room data reset. Conversation cleared.");
      return true;
    default:
      return false;
  }
}

function quit() {
  console.log("\nGoodbye! 🏨\n");
  rl.close();
}

function handleError(err: unknown): boolean {
  const error = err as Error;
  if (error.message?.includes("ECONNREFUSED")) {
    console.error("\n❌ Could not connect to Ollama.");
    console.error("   Make sure Ollama is running: ollama serve");
    console.error(
      `   And that you have the model pulled: ollama pull ${process.env.MODEL ?? "qwen2.5:7b"}\n`,
    );
    rl.close();
    return false;
  }
  console.error("\n❌ Error:", error.message);
  return true;
}

async function chat() {
  printDivider();
  process.stdout.write(`You [${mode}]: `);

  rl.once("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return chat();
    if (trimmed.toLowerCase() === "exit") return quit();

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      if (!handleCommand(trimmed)) {
        console.log(`\nUnknown command: ${trimmed}`);
        console.log("  Available: /corrective, /blind, /crash, /reset");
      }
      return chat();
    }

    try {
      const result = await runAgentWithRecovery(trimmed, history, mode);
      history = result.messages;
      printResponse(history);
      printStats(result.toolStats, result.mode);
    } catch (err) {
      if (!handleError(err)) return;
    }

    chat();
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

printWelcome();
chat();
