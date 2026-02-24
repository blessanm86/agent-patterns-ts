import * as readline from "readline";
import { runAgent } from "./agent.js";
import { weakTools, strongTools } from "./tools.js";
import type { Message } from "./types.js";

// ─── Mode Selection ───────────────────────────────────────────────────────────
//
// Pass --weak to run with minimal tool descriptions and see where the model
// goes wrong. The default (no flag) runs with engineered descriptions.

const useWeak = process.argv.includes("--weak");
const tools = useWeak ? weakTools : strongTools;
const modeName = useWeak ? "WEAK descriptions" : "STRONG descriptions";

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────

let history: Message[] = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printDivider() {
  console.log("\n" + "─".repeat(50));
}

function printWelcome() {
  console.log("\n📋  Customer Support Agent — Tool Description Engineering");
  console.log("    Powered by Ollama + " + (process.env.MODEL ?? "qwen2.5:7b"));
  console.log(`    Mode: ${modeName}`);
  console.log('    Type "exit" to quit\n');

  if (useWeak) {
    console.log("⚠️   Running with WEAK tool descriptions.");
    console.log("    Watch for: wrong parameter formats, skipped steps, over-escalation.\n");
  } else {
    console.log("✅  Running with STRONG tool descriptions.");
    console.log("    Compare with: pnpm dev:tool-descriptions:weak\n");
  }

  console.log("💡  Try these prompts to expose description quality differences:");
  console.log('    "I want a refund for customer John Smith on order ORD-001"');
  console.log("       → Weak: passes a name instead of an email");
  console.log('    "Give me a refund on ORD-001" (no lookup first)');
  console.log("       → Weak: may skip get_order_details and jump to issue_refund");
  console.log('    "I already got a refund but I want another one for ORD-002"');
  console.log("       → Weak: may attempt to refund an already-refunded order");
  console.log('    "I just have a quick question about my order status"');
  console.log("       → Weak: may unnecessarily escalate_to_human\n");
}

function printResponse(history: Message[]) {
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) {
    printDivider();
    console.log(`\nAgent: ${lastAssistant.content}`);
  }
}

function quit() {
  console.log("\nGoodbye! 📋\n");
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
  process.stdout.write("You: ");

  rl.once("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return chat();
    if (trimmed.toLowerCase() === "exit") return quit();

    try {
      history = await runAgent(trimmed, history, tools);
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
