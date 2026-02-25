import * as readline from "readline";
import { runGraphAgent } from "./agent.js";
import type { Message } from "../shared/types.js";

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────

let history: Message[] = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printDivider() {
  console.log("\n" + "─".repeat(60));
}

function printWelcome() {
  console.log("\n🏨  State Graph Demo — The Grand TypeScript Hotel");
  console.log("    Powered by Ollama + " + (process.env.MODEL ?? "qwen2.5:7b"));
  console.log('    Type "exit" to quit\n');
  console.log("💡  Same hotel agent, now running as a state graph.");
  console.log("    Watch the [graph] → logs to see node transitions.\n");
  console.log('    Try: "I\'d like to book a double room from 2026-03-01 to 2026-03-05"');
  console.log('    Try: "What rooms do you have available next weekend?"');
  console.log('    Try: "How much does a suite cost for 3 nights?"');
}

function printResponse(messages: Message[]) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) {
    printDivider();
    console.log(`\nAgent: ${lastAssistant.content}`);
  }
}

function printTrace(nodeTrace: string[], iterations: number) {
  console.log(`\n  📊 Trace: ${nodeTrace.join(" -> ")}`);
  console.log(`     Iterations: ${iterations}`);
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
  process.stdout.write("You: ");

  rl.once("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return chat();
    if (trimmed.toLowerCase() === "exit") return quit();

    try {
      const result = await runGraphAgent(trimmed, history);
      history = result.messages;
      printResponse(history);
      printTrace(result.nodeTrace, result.iterations);
    } catch (err) {
      if (!handleError(err)) return;
    }

    chat();
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

printWelcome();
chat();
