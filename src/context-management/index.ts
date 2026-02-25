import "dotenv/config";
import { runAgent } from "./agent.js";
import { resetNotes } from "./tools.js";
import { estimateMessageTokens, formatTokenCount } from "./token-counter.js";
import { createSlidingWindowStrategy } from "./strategies/sliding-window.js";
import { createSummaryBufferStrategy } from "./strategies/summary-buffer.js";
import { createObservationMaskingStrategy } from "./strategies/observation-masking.js";
import { createCLI } from "../shared/cli.js";
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

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printInlineStats(history: Message[]) {
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

createCLI({
  title: "Tech Research Assistant — Context Window Management Demo",
  emoji: "📚",
  goodbye: "Goodbye! 📚",
  agentLabel: "Assistant",
  dividerWidth: 60,
  welcomeLines: [
    `    Token budget: ${formatTokenCount(CONFIG.tokenBudget)}`,
    `    Strategy: ${currentStrategy?.name ?? "none"}`,
    "",
    "    Slash commands:",
    "      /strategy <name>  — switch strategy (none, sliding-window, summary-buffer, observation-masking)",
    "      /stats            — show token usage breakdown",
    "      /reset            — clear conversation history",
    "",
    "    Sample prompts:",
    '      "What articles do you have about AI agents?"',
    '      "Read the article about context windows"',
    '      "Compare testing strategies with error handling patterns"',
  ],
  async onMessage(input, history) {
    const result = await runAgent(input, history, currentStrategy, CONFIG.tokenBudget);
    const { contextStats } = result;
    const tokensSaved = contextStats.triggered
      ? contextStats.tokensBefore - contextStats.tokensAfter
      : 0;

    const parts = [
      `Tokens: ~${formatTokenCount(contextStats.tokensBefore)}/${formatTokenCount(CONFIG.tokenBudget)}`,
      `Strategy: ${contextStats.strategyName}`,
    ];
    if (contextStats.triggered) {
      parts.push(`Managed: yes (-${formatTokenCount(tokensSaved)} tokens)`);
    }

    return {
      messages: result.messages,
      stats: [`\n📊  ${parts.join(" | ")}`],
    };
  },
  onCommand(cmd, history) {
    if (cmd === "/stats") {
      printInlineStats(history);
      return true;
    }

    if (cmd === "/reset") {
      resetNotes();
      console.log("\n🗑️  History cleared.");
      return { handled: true, newHistory: [] };
    }

    if (cmd.startsWith("/strategy")) {
      const name = cmd.slice("/strategy".length).trim();
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
  },
}).start();
