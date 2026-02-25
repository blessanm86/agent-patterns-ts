import "dotenv/config";
import * as readline from "readline";
import { runAgent } from "./agent.js";
import { resetNotes } from "./tools.js";
import { estimateMessageTokens, formatTokenCount } from "./token-counter.js";
import { createSlidingWindowStrategy } from "./strategies/sliding-window.js";
import { createSummaryBufferStrategy } from "./strategies/summary-buffer.js";
import { createObservationMaskingStrategy } from "./strategies/observation-masking.js";
import type { Message } from "../shared/types.js";
import type { ContextStrategy } from "./strategies/types.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  tokenBudget: 8_000, // Deliberately low to trigger management quickly
  summaryBufferSize: 6, // Keep last 6 messages verbatim
  observationWindow: 3, // Keep last 3 tool results verbatim
};

// ─── Strategy Registry ───────────────────────────────────────────────────────

const STRATEGIES: Record<string, ContextStrategy> = {
  "sliding-window": createSlidingWindowStrategy(),
  "summary-buffer": createSummaryBufferStrategy(CONFIG.summaryBufferSize),
  "observation-masking": createObservationMaskingStrategy(CONFIG.observationWindow),
};

let currentStrategy: ContextStrategy | null = STRATEGIES["observation-masking"];
let history: Message[] = [];

// ─── CLI ─────────────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printDivider() {
  console.log("\n" + "-".repeat(60));
}

function printWelcome() {
  const model = process.env.MODEL ?? "qwen2.5:7b";
  console.log("\n📚  Tech Research Assistant — Context Window Management Demo");
  console.log(`    Powered by Ollama + ${model}`);
  console.log(`    Token budget: ${formatTokenCount(CONFIG.tokenBudget)}`);
  console.log(`    Strategy: ${currentStrategy?.name ?? "none"}`);
  console.log('\n    Type "exit" to quit');
  console.log("");
  console.log("    Slash commands:");
  console.log(
    "      /strategy <name>  — switch strategy (none, sliding-window, summary-buffer, observation-masking)",
  );
  console.log("      /stats            — show token usage breakdown");
  console.log("      /reset            — clear conversation history");
  console.log("");
  console.log("    Sample prompts:");
  console.log('      "What articles do you have about AI agents?"');
  console.log('      "Read the article about context windows"');
  console.log('      "Compare testing strategies with error handling patterns"');
}

function printStats() {
  const tokens = estimateMessageTokens(history);
  const messageCount = history.length;
  const toolMessages = history.filter((m) => m.role === "tool").length;
  const assistantMessages = history.filter((m) => m.role === "assistant").length;
  const userMessages = history.filter((m) => m.role === "user").length;

  console.log("\n📊  Context Stats:");
  console.log(
    `    Messages: ${messageCount} (user: ${userMessages}, assistant: ${assistantMessages}, tool: ${toolMessages})`,
  );
  console.log(`    Tokens: ~${formatTokenCount(tokens)} / ${formatTokenCount(CONFIG.tokenBudget)}`);
  console.log(`    Strategy: ${currentStrategy?.name ?? "none"}`);
  console.log(`    Usage: ${Math.round((tokens / CONFIG.tokenBudget) * 100)}% of budget`);
}

function printStatsFooter(
  tokensNow: number,
  strategyName: string,
  triggered: boolean,
  tokensSaved: number,
) {
  const parts = [
    `Tokens: ~${formatTokenCount(tokensNow)}/${formatTokenCount(CONFIG.tokenBudget)}`,
    `Strategy: ${strategyName}`,
  ];
  if (triggered) {
    parts.push(`Managed: yes (-${formatTokenCount(tokensSaved)} tokens)`);
  }
  console.log(`\n📊  ${parts.join(" | ")}`);
}

function handleSlashCommand(input: string): boolean {
  if (input === "/stats") {
    printStats();
    return true;
  }

  if (input === "/reset") {
    history = [];
    resetNotes();
    console.log("\n🗑️  History cleared.");
    return true;
  }

  if (input.startsWith("/strategy")) {
    const name = input.slice("/strategy".length).trim();
    if (name === "none") {
      currentStrategy = null;
      console.log("\n⚙️  Strategy: none (no context management)");
    } else if (STRATEGIES[name]) {
      currentStrategy = STRATEGIES[name];
      console.log(`\n⚙️  Strategy: ${name} — ${currentStrategy.description}`);
    } else {
      console.log(
        `\n❌  Unknown strategy: "${name}". Options: none, ${Object.keys(STRATEGIES).join(", ")}`,
      );
    }
    return true;
  }

  return false;
}

function printResponse(messages: Message[]) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) {
    printDivider();
    console.log(`\nAssistant: ${lastAssistant.content}`);
  }
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

function quit() {
  console.log("\nGoodbye! 📚\n");
  rl.close();
}

async function chat() {
  printDivider();
  process.stdout.write("You: ");

  rl.once("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return chat();
    if (trimmed.toLowerCase() === "exit") return quit();

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      handleSlashCommand(trimmed);
      return chat();
    }

    try {
      const result = await runAgent(trimmed, history, currentStrategy, CONFIG.tokenBudget);
      history = result.messages;
      printResponse(history);

      // Stats footer
      const { contextStats } = result;
      const tokensSaved = contextStats.triggered
        ? contextStats.tokensBefore - contextStats.tokensAfter
        : 0;
      printStatsFooter(
        contextStats.tokensBefore,
        contextStats.strategyName,
        contextStats.triggered,
        tokensSaved,
      );
    } catch (err) {
      if (!handleError(err)) return;
    }

    chat();
  });
}

// ─── Start ───────────────────────────────────────────────────────────────────

printWelcome();
chat();
