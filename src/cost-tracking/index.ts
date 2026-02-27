import ollama from "ollama";
import { runAgent, type ModelMap } from "./agent.js";
import { resetMockData } from "./tools.js";
import { CostTracker } from "./costs.js";
import { createCLI } from "../shared/cli.js";

// ─── Model Configuration ────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.MODEL ?? "qwen2.5:7b";
const FAST_MODEL = process.env.FAST_MODEL ?? "qwen2.5:1.5b";
const CAPABLE_MODEL = process.env.CAPABLE_MODEL ?? "qwen2.5:14b";

async function resolveModels(): Promise<ModelMap> {
  // Check which models are actually available locally
  const available = new Set<string>();
  try {
    const list = await ollama.list();
    for (const model of list.models) {
      available.add(model.name);
      // Also add without :latest suffix for matching
      const baseName = model.name.replace(":latest", "");
      available.add(baseName);
    }
  } catch {
    console.error("  Could not connect to Ollama. Make sure it's running: ollama serve");
    process.exit(1);
  }

  function resolve(preferred: string, fallback: string, tier: string): string {
    if (available.has(preferred)) return preferred;
    console.log(`  Note: ${preferred} not found, using ${fallback} for ${tier} tier`);
    return fallback;
  }

  return {
    fast: resolve(FAST_MODEL, DEFAULT_MODEL, "fast"),
    standard: DEFAULT_MODEL,
    capable: resolve(CAPABLE_MODEL, DEFAULT_MODEL, "capable"),
  };
}

// ─── CLI Chat Loop ──────────────────────────────────────────────────────────

async function main() {
  const models = await resolveModels();
  const costTracker = new CostTracker();
  let lastSummary: string[] | null = null;

  createCLI({
    title: "The Grand TypeScript Hotel \u2014 Cost-Tracked Agent",
    emoji: "\uD83D\uDCB0",
    goodbye: "Goodbye! \uD83D\uDCB0",
    welcomeLines: [
      "",
      `    Model tiers:`,
      `      Fast:     ${models.fast}`,
      `      Standard: ${models.standard}`,
      `      Capable:  ${models.capable}`,
      "",
      "    Each query is routed to the cheapest model that can handle it.",
      "    After each response you'll see a cost breakdown with savings vs all-capable.",
      "",
      "    /costs  \u2014 reprint the last cost summary",
      "    /reset  \u2014 clear conversation history and mock data",
      "",
      '    Try: "Hello!" (fast) \u2192 "Book a double room March 1-5" (standard)',
      '      \u2192 "Compare all room types for 5 nights and recommend the best value" (capable)',
    ],
    onCommand(command) {
      if (command === "/costs") {
        if (lastSummary) {
          for (const line of lastSummary) {
            console.log(line);
          }
        } else {
          console.log("  No cost data yet. Send a message first.");
        }
        return true;
      }
      if (command === "/reset") {
        resetMockData();
        costTracker.reset();
        lastSummary = null;
        console.log("  History, mock data, and cost tracker cleared.");
        return { handled: true, newHistory: [] };
      }
      return false;
    },
    async onMessage(input, history) {
      costTracker.reset();

      const messages = await runAgent(input, history, models, costTracker);
      lastSummary = costTracker.formatSummary(models.capable);

      return {
        messages,
        stats: lastSummary,
      };
    },
  }).start();
}

main();
