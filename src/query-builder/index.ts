import { runAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";
import type { QueryMode } from "./types.js";

// ─── Mode Selection ─────────────────────────────────────────────────────────
//
// --raw: LLM writes MetricsQL query strings (error-prone)
// default: LLM fills structured parameters (query builder pattern)

const mode: QueryMode = process.argv.includes("--raw") ? "raw" : "builder";
const modeName =
  mode === "raw" ? "RAW (LLM writes query strings)" : "BUILDER (structured parameters)";

// ─── CLI Chat Loop ──────────────────────────────────────────────────────────

const welcomeLines: string[] = [`    Mode: ${modeName}`, ""];

if (mode === "raw") {
  welcomeLines.push(
    "    Running in RAW mode — the LLM writes MetricsQL query strings directly.",
    "    Watch for syntax errors. Compare with: pnpm dev:query-builder",
    "",
  );
} else {
  welcomeLines.push(
    "    Running in BUILDER mode — the LLM fills structured parameters.",
    "    The system constructs valid queries. Compare with: pnpm dev:query-builder:raw",
    "",
  );
}

welcomeLines.push(
  "    Try these prompts:",
  '    "How many HTTP requests is the api-gateway handling?"',
  '    "What is the p99 latency for checkout-service by method?"',
  '    "Show me error rates for payment-gateway"',
  '    "Which service has the highest CPU usage?"',
  '    "What is the average memory usage across all services?"',
  "",
);

createCLI({
  title: "Metrics Monitor — Query Builder Pattern",
  emoji: "📈",
  goodbye: "Goodbye! 📈",
  welcomeLines,
  async onMessage(input, history) {
    const result = await runAgent(input, history, mode);

    const stats: string[] = [];
    const { queryStats } = result;

    if (queryStats.totalQueries > 0) {
      const successRate =
        queryStats.totalQueries > 0
          ? Math.round((queryStats.successfulQueries / queryStats.totalQueries) * 100)
          : 0;

      stats.push("");
      stats.push(
        `  📊 Query stats: ${queryStats.successfulQueries}/${queryStats.totalQueries} succeeded (${successRate}%)`,
      );

      if (queryStats.failedQueries > 0) {
        stats.push(`  ❌ ${queryStats.failedQueries} failed:`);
        for (const err of queryStats.errors) {
          stats.push(`     • ${err.slice(0, 100)}`);
        }
      }
    }

    return { messages: result.messages, stats };
  },
}).start();
