import { runAgent } from "./agent.js";
import { resetMockData } from "./tools.js";
import { initTracing } from "./tracing.js";
import { createCLI } from "../shared/cli.js";
import type { TraceSummary } from "./types.js";

// ─── Trace Summary Formatting ────────────────────────────────────────────────

function formatTraceSummary(summary: TraceSummary): string[] {
  const totalTokens = summary.inputTokens + summary.outputTokens;
  return [
    "",
    "  \u2500\u2500 Trace Summary \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    `  Duration:    ${summary.durationMs.toLocaleString("en-US", { maximumFractionDigits: 0 })}ms`,
    `  LLM calls:   ${summary.llmCalls}  |  Tool calls: ${summary.toolCalls}`,
    `  Tokens:      ${totalTokens.toLocaleString("en-US")} (${summary.inputTokens.toLocaleString("en-US")} in + ${summary.outputTokens.toLocaleString("en-US")} out)`,
    `  Est. cost:   $${summary.estimatedCost.toFixed(4)} (at GPT-4o pricing)`,
    "  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
  ];
}

// ─── CLI Chat Loop ───────────────────────────────────────────────────────────

const { tracer, collector, shutdown } = initTracing();
let lastSummary: TraceSummary | null = null;

createCLI({
  title: "The Grand TypeScript Hotel — Instrumented Agent",
  emoji: "\uD83D\uDD2D",
  goodbye: "Goodbye! \uD83D\uDD2D",
  welcomeLines: [
    "\uD83D\uDCA1  OpenTelemetry traces print inline as the agent runs.",
    "    After each response you'll see a trace summary with token counts and cost.",
    "",
    "    /trace  — reprint the last trace summary",
    "    /reset  — clear conversation history and mock data",
    "",
    '    Try: "I\'d like to book a double room from 2026-03-01 to 2026-03-05"',
  ],
  onCommand(command) {
    if (command === "/trace") {
      if (lastSummary) {
        for (const line of formatTraceSummary(lastSummary)) {
          console.log(line);
        }
      } else {
        console.log("  No trace data yet. Send a message first.");
      }
      return true;
    }
    if (command === "/reset") {
      resetMockData();
      lastSummary = null;
      collector.reset();
      console.log("  History, mock data, and trace data cleared.");
      return { handled: true, newHistory: [] };
    }
    return false;
  },
  async onMessage(input, history) {
    // Reset collector so each message gets fresh metrics
    collector.reset();

    const messages = await runAgent(input, history, tracer);

    lastSummary = collector.getSummary();

    return {
      messages,
      stats: formatTraceSummary(lastSummary),
    };
  },
}).start();

// Graceful shutdown on process exit
process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});
