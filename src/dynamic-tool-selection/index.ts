import { runAgent, initAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";
import type { SelectionStrategy } from "./types.js";

// ─── CLI Entry Point ─────────────────────────────────────────────────────────
//
// Three modes to compare tool selection strategies:
//
//   pnpm dev:dynamic-tools           → embedding-based selection (default)
//   pnpm dev:dynamic-tools:all       → all 27 tools sent every turn
//   pnpm dev:dynamic-tools:llm       → LLM-based selection
//
// Each turn prints stats: which tools were selected, token estimate, and
// savings vs. sending all tools.

const strategy: SelectionStrategy = process.argv.includes("--all")
  ? "all"
  : process.argv.includes("--llm")
    ? "llm"
    : "embedding";

const strategyLabels: Record<SelectionStrategy, string> = {
  all: "All Tools (no filtering)",
  embedding: "Embedding-Based Selection",
  llm: "LLM-Based Selection",
};

async function main() {
  await initAgent(strategy);

  createCLI({
    title: `Multi-Domain Assistant — ${strategyLabels[strategy]}`,
    emoji: "🔍",
    goodbye: "Goodbye!",
    welcomeLines: [
      `    Strategy: ${strategyLabels[strategy]}`,
      `    27 tools across e-commerce, recipes, and travel`,
      "",
      '    Try: "Find me wireless headphones under $150"        (e-commerce)',
      '    Try: "How do I make spaghetti carbonara?"             (recipes)',
      '    Try: "Search flights from SFO to JFK on April 15"    (travel)',
      '    Try: "Convert 2 cups to milliliters"                  (recipes)',
      '    Try: "What\'s the weather in Tokyo next week?"         (travel)',
    ],
    async onMessage(input, history) {
      const { messages, stats } = await runAgent(input, history, strategy);
      return { messages, stats };
    },
  }).start();
}

main();
