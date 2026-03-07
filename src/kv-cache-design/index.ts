import "dotenv/config";
import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { tools, resetState } from "./tools.js";
import { runTurn } from "./agent.js";
import { strategies, cacheOptimizedStrategy } from "./strategies.js";
import type { Message } from "../shared/types.js";
import type { TurnMetrics, StrategyResult, CostProjection } from "./types.js";

// ─── KV-Cache-Aware Context Design — Benchmark ─────────────────────────────
//
// Runs a simulated 20-turn conversation through three context strategies:
//   1. Naive — timestamps, tool shuffling, history mutation (cache-hostile)
//   2. Append-Only — stable prefix, fixed tools, no mutations (cache-friendly)
//   3. Cache-Optimized — append-only + tool masking + restorable compression
//
// For each strategy, measures prompt_eval_count and timing per turn.
// Lower prompt_eval_count on turns 2+ indicates KV-cache prefix reuse.

// ─── Simulated Conversation ─────────────────────────────────────────────────
//
// 20 user messages that form a coherent recipe planning session.
// These are the same across all strategies for a fair comparison.

const CONVERSATION: string[] = [
  "I want to plan meals for this week. What Italian recipes do you have?",
  "Tell me more about the Margherita Pizza — what ingredients do I need?",
  "Can you scale that pizza recipe to 8 servings?",
  "What are some Thai options? I love spicy food.",
  "Get me the details on the Thai Green Curry.",
  "Add the Margherita Pizza to Monday dinner.",
  "Add the Thai Green Curry to Tuesday dinner.",
  "What's the nutritional info for the green curry?",
  "I'm allergic to dairy — what can I substitute for heavy cream?",
  "Search for Mexican recipes.",
  "Tell me about the street tacos — full details please.",
  "Any cooking tips for making those tacos?",
  "Add the tacos to Wednesday dinner.",
  "What Japanese recipes do you have?",
  "Get me the full details on the Miso Ramen.",
  "Those ramen tips — what should I watch out for?",
  "Add the ramen to Thursday dinner.",
  "Save the Miso Ramen as a favorite — note: weekend project.",
  "Show me my meal plan so far.",
  "Generate a shopping list for everything in the plan.",
];

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function padNum(n: number, len: number): string {
  const s = String(n);
  return " ".repeat(Math.max(0, len - s.length)) + s;
}

function printTurnTable(result: StrategyResult): void {
  console.log(`\n  ${result.strategy}`);
  console.log(
    `  ${pad("Turn", 6)} ${pad("Prompt Toks", 13)} ${pad("Prompt (ms)", 13)} ${pad("Resp (ms)", 11)} ${pad("Total (ms)", 12)}`,
  );
  console.log(`  ${"─".repeat(55)}`);

  for (const t of result.turns) {
    console.log(
      `  ${pad(`#${t.turn}`, 6)} ${padNum(t.promptTokens, 13)} ${padNum(t.promptEvalMs, 13)} ${padNum(t.responseEvalMs, 11)} ${padNum(t.totalMs, 12)}`,
    );
  }

  console.log(`  ${"─".repeat(55)}`);
  console.log(
    `  ${pad("Avg", 6)} ${padNum(result.avgPromptTokens, 13)} ${padNum(result.avgPromptEvalMs, 13)}`,
  );
  console.log(
    `  ${pad("Warm", 6)} ${padNum(result.warmAvgPromptTokens, 13)} ${padNum(result.warmAvgPromptEvalMs, 13)}   (turns 2+, cache-warm)`,
  );
}

function avg(turns: TurnMetrics[], getter: (t: TurnMetrics) => number): number {
  if (turns.length === 0) return 0;
  return Math.round(turns.reduce((sum, t) => sum + getter(t), 0) / turns.length);
}

// ─── Cost Projections ────────────────────────────────────────────────────────
//
// Show what the three strategies would cost at scale on cloud providers.
// Uses the average prompt tokens from the benchmark as the baseline.

function projectCosts(result: StrategyResult, requestCount: number): CostProjection[] {
  const avgPromptTokens = result.warmAvgPromptTokens;
  const avgResponseTokens = avg(result.turns, (t) => t.responseTokens);
  const projections: CostProjection[] = [];

  // Anthropic Claude Sonnet 4.6: $3/M input, $0.30/M cached read, $3.75/M cache write
  {
    const perRequestInput = avgPromptTokens;
    const uncachedCost =
      ((perRequestInput * requestCount) / 1_000_000) * 3.0 +
      ((avgResponseTokens * requestCount) / 1_000_000) * 15.0;

    // With caching: first request is a write, rest are reads
    const writeCost = (perRequestInput / 1_000_000) * 3.75;
    const readCost = (perRequestInput / 1_000_000) * 0.3;
    const cachedCost =
      writeCost +
      readCost * (requestCount - 1) +
      ((avgResponseTokens * requestCount) / 1_000_000) * 15.0;

    const savings = uncachedCost - cachedCost;
    projections.push({
      provider: "Anthropic (Sonnet 4.6)",
      withoutCaching: Math.round(uncachedCost * 10000) / 10000,
      withCaching: Math.round(cachedCost * 10000) / 10000,
      savings: Math.round(savings * 10000) / 10000,
      savingsPercent: Math.round((savings / uncachedCost) * 100),
    });
  }

  // OpenAI GPT-4.1: $2/M input, $0.50/M cached, no write premium
  {
    const perRequestInput = avgPromptTokens;
    const uncachedCost =
      ((perRequestInput * requestCount) / 1_000_000) * 2.0 +
      ((avgResponseTokens * requestCount) / 1_000_000) * 8.0;

    const firstCost = (perRequestInput / 1_000_000) * 2.0;
    const cachedReadCost = (perRequestInput / 1_000_000) * 0.5;
    const cachedCost =
      firstCost +
      cachedReadCost * (requestCount - 1) +
      ((avgResponseTokens * requestCount) / 1_000_000) * 8.0;

    const savings = uncachedCost - cachedCost;
    projections.push({
      provider: "OpenAI (GPT-4.1)",
      withoutCaching: Math.round(uncachedCost * 10000) / 10000,
      withCaching: Math.round(cachedCost * 10000) / 10000,
      savings: Math.round(savings * 10000) / 10000,
      savingsPercent: Math.round((savings / uncachedCost) * 100),
    });
  }

  // DeepSeek V3: $0.28/M input, $0.028/M cached (90% savings)
  {
    const perRequestInput = avgPromptTokens;
    const uncachedCost =
      ((perRequestInput * requestCount) / 1_000_000) * 0.28 +
      ((avgResponseTokens * requestCount) / 1_000_000) * 1.1;

    const firstCost = (perRequestInput / 1_000_000) * 0.28;
    const cachedReadCost = (perRequestInput / 1_000_000) * 0.028;
    const cachedCost =
      firstCost +
      cachedReadCost * (requestCount - 1) +
      ((avgResponseTokens * requestCount) / 1_000_000) * 1.1;

    const savings = uncachedCost - cachedCost;
    projections.push({
      provider: "DeepSeek (V3)",
      withoutCaching: Math.round(uncachedCost * 10000) / 10000,
      withCaching: Math.round(cachedCost * 10000) / 10000,
      savings: Math.round(savings * 10000) / 10000,
      savingsPercent: Math.round((savings / uncachedCost) * 100),
    });
  }

  return projections;
}

// ─── Run a Strategy ─────────────────────────────────────────────────────────

async function runStrategy(strategyIndex: number, maxTurns: number): Promise<StrategyResult> {
  const strategy = strategies[strategyIndex];
  resetState(); // Reset meal plan, favorites between strategies
  cacheOptimizedStrategy.offloadedContent = []; // Reset compression log

  let history: Message[] = [];
  const allMetrics: TurnMetrics[] = [];

  const turns = Math.min(maxTurns, CONVERSATION.length);

  for (let i = 0; i < turns; i++) {
    const turn = i + 1;
    process.stdout.write(`  Turn ${padNum(turn, 2)}/${turns}...`);

    const result = await runTurn(CONVERSATION[i], history, turn, strategy);
    history = result.history;
    allMetrics.push(result.metrics);

    console.log(
      ` prompt: ${padNum(result.metrics.promptTokens, 5)} toks, ${padNum(result.metrics.promptEvalMs, 5)}ms`,
    );
  }

  const warmTurns = allMetrics.slice(1);

  return {
    strategy: strategy.name,
    turns: allMetrics,
    avgPromptTokens: avg(allMetrics, (t) => t.promptTokens),
    avgPromptEvalMs: avg(allMetrics, (t) => t.promptEvalMs),
    warmAvgPromptTokens: avg(warmTurns, (t) => t.promptTokens),
    warmAvgPromptEvalMs: avg(warmTurns, (t) => t.promptEvalMs),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const maxTurns = parseInt(
    process.argv.find((a) => a.startsWith("--turns="))?.split("=")[1] ?? "20",
    10,
  );

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║     KV-Cache-Aware Context Design — Benchmark           ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`  Model:          ${MODEL}`);
  console.log(`  Tools:          ${tools.length} recipe tools`);
  console.log(`  Conversation:   ${Math.min(maxTurns, CONVERSATION.length)} turns`);
  console.log(`  Strategies:     ${strategies.map((s) => s.name).join(", ")}`);

  // Warm up: load model into memory
  console.log("\n  Warming up model...");
  await ollama.chat({
    model: MODEL,
    messages: [{ role: "user", content: "Hello" }],
  });
  console.log("  Model ready.\n");

  const results: StrategyResult[] = [];

  for (let i = 0; i < strategies.length; i++) {
    console.log(`  ━━━ Strategy ${i + 1}/${strategies.length}: ${strategies[i].name} ━━━\n`);
    const result = await runStrategy(i, maxTurns);
    results.push(result);
    console.log();
  }

  // ── Per-strategy detail tables ──
  console.log("\n  ═══ Results ═══");
  for (const result of results) {
    printTurnTable(result);
  }

  // ── Summary comparison ──
  console.log("\n  ━━━ Strategy Comparison ━━━\n");
  console.log(
    `  ${pad("Strategy", 38)} ${pad("Avg Prompt Toks", 17)} ${pad("Avg Prompt (ms)", 17)} ${pad("Warm Toks", 11)} ${pad("Warm (ms)", 11)}`,
  );
  console.log(`  ${"─".repeat(94)}`);

  for (const r of results) {
    console.log(
      `  ${pad(r.strategy, 38)} ${padNum(r.avgPromptTokens, 17)} ${padNum(r.avgPromptEvalMs, 17)} ${padNum(r.warmAvgPromptTokens, 11)} ${padNum(r.warmAvgPromptEvalMs, 11)}`,
    );
  }

  // Show improvement of append-only over naive
  if (results.length >= 2) {
    const naive = results[0];
    const appendOnly = results[1];
    if (
      naive.warmAvgPromptEvalMs > 0 &&
      appendOnly.warmAvgPromptEvalMs < naive.warmAvgPromptEvalMs
    ) {
      const speedup = Math.round(
        (1 - appendOnly.warmAvgPromptEvalMs / naive.warmAvgPromptEvalMs) * 100,
      );
      console.log(
        `\n  Append-only is ~${speedup}% faster than naive on prompt evaluation (warm turns).`,
      );
    }
    if (results.length >= 3) {
      const optimized = results[2];
      if (
        naive.warmAvgPromptTokens > 0 &&
        optimized.warmAvgPromptTokens < naive.warmAvgPromptTokens
      ) {
        const tokenReduction = Math.round(
          (1 - optimized.warmAvgPromptTokens / naive.warmAvgPromptTokens) * 100,
        );
        console.log(
          `  Cache-optimized uses ~${tokenReduction}% fewer prompt tokens than naive (warm turns).`,
        );
      }
    }
  }

  // ── Cost projections ──
  const requestCount = 1000;
  console.log(`\n  ━━━ Cost Projections (${requestCount.toLocaleString()} requests) ━━━\n`);
  console.log("  What these strategies would cost at scale on cloud providers.");
  console.log("  'With cache' assumes stable prefix → cache hits on turns 2+.\n");

  // Use append-only for "with cache" and naive for "without cache"
  if (results.length >= 2) {
    const costs = projectCosts(results[1], requestCount);

    console.log(
      `  ${pad("Provider", 24)} ${pad("No Cache", 12)} ${pad("With Cache", 12)} ${pad("Savings", 10)} ${pad("%", 5)}`,
    );
    console.log(`  ${"─".repeat(63)}`);

    for (const c of costs) {
      console.log(
        `  ${pad(c.provider, 24)} $${pad(c.withoutCaching.toFixed(4), 11)} $${pad(c.withCaching.toFixed(4), 11)} $${pad(c.savings.toFixed(4), 9)} ${c.savingsPercent}%`,
      );
    }
  }

  // ── What went wrong in the naive strategy ──
  console.log("\n  ━━━ Why Naive Destroys the Cache ━━━\n");
  console.log("  Three anti-patterns demonstrated in the naive strategy:\n");
  console.log("  1. TIMESTAMP IN SYSTEM PROMPT — changes every request,");
  console.log("     invalidating the entire cache from token 0.\n");
  console.log("  2. SHUFFLED TOOL ORDER — tool definitions come early in");
  console.log("     the prefix; randomizing their order invalidates all");
  console.log("     downstream tokens (history, user messages).\n");
  console.log("  3. MUTATED HISTORY — editing previous messages changes");
  console.log("     the prefix from that point forward, destroying cache");
  console.log("     reuse for everything after the edit.\n");
  console.log("  The fix: stable prefix, append-only growth, dynamic suffix.");
  console.log("  This is the universal pattern across all production harnesses.\n");
}

main().catch(console.error);
