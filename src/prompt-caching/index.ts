import "dotenv/config";
import ollama from "ollama";
import { SYSTEM_PROMPT, runBenchmarkRequest } from "./agent.js";
import { tools } from "./tools.js";
import { MODEL } from "../shared/config.js";
import type { BenchmarkRun, BenchmarkResult, ProviderCost, CacheMetrics } from "./types.js";

// ─── Prompt Caching — Benchmark Demo ─────────────────────────────────────────
//
// Measures Ollama's built-in KV-cache prefix reuse by running two phases:
//   1. Stable prefix — identical system prompt + tools on every request
//   2. Rotating prefix — system prompt changes slightly each request
//
// On a cache hit, prompt_eval_count drops (only new tokens need evaluation).
// On a miss, the full prompt is re-evaluated from scratch.
//
// After the benchmark, a cost calculator shows what this would cost on
// Anthropic, OpenAI, and Google Gemini with and without caching.

// ─── Test Questions ──────────────────────────────────────────────────────────

const TEST_QUESTIONS = [
  "What's the status of order ORD-001?",
  "Find all orders for sarah@example.com",
  "I need a refund for order ORD-003, the USB-C hub is defective",
  "What's the return policy for electronics?",
  "Escalate order ORD-004 to a human — the customer is upset about the $580 charge",
];

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function padNum(n: number, len: number): string {
  const s = String(n);
  return " ".repeat(Math.max(0, len - s.length)) + s;
}

function printMetricsTable(label: string, runs: BenchmarkRun[]): void {
  console.log(`\n  ${label}`);
  console.log(
    `  ${pad("Run", 5)} ${pad("Prompt Tokens", 15)} ${pad("Prompt Eval (ms)", 18)} ${pad("Response (ms)", 15)} ${pad("Total (ms)", 12)}`,
  );
  console.log(`  ${"─".repeat(65)}`);

  for (const run of runs) {
    const m = run.metrics;
    console.log(
      `  ${pad(run.label, 5)} ${padNum(m.promptTokens, 15)} ${padNum(m.promptEvalMs, 18)} ${padNum(m.responseEvalMs, 15)} ${padNum(m.totalMs, 12)}`,
    );
  }
}

function avgMetric(runs: BenchmarkRun[], getter: (m: CacheMetrics) => number): number {
  const values = runs.map((r) => getter(r.metrics));
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

// ─── Cost Calculator ─────────────────────────────────────────────────────────
//
// Published pricing per 1M tokens (as of early 2026):
//
// Anthropic Claude 3.5 Sonnet:
//   Input:  $3.00/1M   Cache write: $3.75/1M   Cache read: $0.30/1M
//
// OpenAI GPT-4o:
//   Input:  $2.50/1M   Cached input: $1.25/1M (automatic, 50% discount)
//
// Google Gemini 1.5 Pro:
//   Input:  $1.25/1M   Cached input: $0.3125/1M (75% discount)

function calculateProviderCosts(
  prefixTokens: number,
  requestCount: number,
  avgResponseTokens: number,
): ProviderCost[] {
  // Per-request non-cached tokens (user message + response)
  const perRequestInputTokens = 50; // ~50 tokens per user question
  const totalResponseTokens = avgResponseTokens * requestCount;

  // Without caching: every request pays full input price for prefix + question
  // With caching: first request pays write price, rest pay read price for prefix

  const providers: ProviderCost[] = [];

  // ── Anthropic Claude 3.5 Sonnet ──
  {
    const inputPer1M = 3.0;
    const outputPer1M = 15.0;
    const cacheWritePer1M = 3.75;
    const cacheReadPer1M = 0.3;

    const totalInputTokens = (prefixTokens + perRequestInputTokens) * requestCount;
    const withoutCaching =
      (totalInputTokens / 1_000_000) * inputPer1M + (totalResponseTokens / 1_000_000) * outputPer1M;

    // First request: write prefix to cache + normal input for question
    // Remaining: read prefix from cache + normal input for question
    const firstInputCost =
      (prefixTokens / 1_000_000) * cacheWritePer1M +
      (perRequestInputTokens / 1_000_000) * inputPer1M;
    const cachedInputCost =
      (prefixTokens / 1_000_000) * cacheReadPer1M +
      (perRequestInputTokens / 1_000_000) * inputPer1M;
    const withCaching =
      firstInputCost +
      cachedInputCost * (requestCount - 1) +
      (totalResponseTokens / 1_000_000) * outputPer1M;

    const savings = withoutCaching - withCaching;
    providers.push({
      provider: "Anthropic (Claude 3.5 Sonnet)",
      withoutCaching: Math.round(withoutCaching * 10000) / 10000,
      withCaching: Math.round(withCaching * 10000) / 10000,
      savings: Math.round(savings * 10000) / 10000,
      savingsPercent: Math.round((savings / withoutCaching) * 100),
    });
  }

  // ── OpenAI GPT-4o ──
  {
    const inputPer1M = 2.5;
    const outputPer1M = 10.0;
    const cachedInputPer1M = 1.25; // 50% discount, automatic

    const totalInputTokens = (prefixTokens + perRequestInputTokens) * requestCount;
    const withoutCaching =
      (totalInputTokens / 1_000_000) * inputPer1M + (totalResponseTokens / 1_000_000) * outputPer1M;

    // OpenAI: automatic caching, first request full price, rest 50% discount on prefix
    const firstInputCost = ((prefixTokens + perRequestInputTokens) / 1_000_000) * inputPer1M;
    const cachedInputCost =
      (prefixTokens / 1_000_000) * cachedInputPer1M +
      (perRequestInputTokens / 1_000_000) * inputPer1M;
    const withCaching =
      firstInputCost +
      cachedInputCost * (requestCount - 1) +
      (totalResponseTokens / 1_000_000) * outputPer1M;

    const savings = withoutCaching - withCaching;
    providers.push({
      provider: "OpenAI (GPT-4o)",
      withoutCaching: Math.round(withoutCaching * 10000) / 10000,
      withCaching: Math.round(withCaching * 10000) / 10000,
      savings: Math.round(savings * 10000) / 10000,
      savingsPercent: Math.round((savings / withoutCaching) * 100),
    });
  }

  // ── Google Gemini 1.5 Pro ──
  {
    const inputPer1M = 1.25;
    const outputPer1M = 5.0;
    const cachedInputPer1M = 0.3125; // 75% discount

    const totalInputTokens = (prefixTokens + perRequestInputTokens) * requestCount;
    const withoutCaching =
      (totalInputTokens / 1_000_000) * inputPer1M + (totalResponseTokens / 1_000_000) * outputPer1M;

    const firstInputCost = ((prefixTokens + perRequestInputTokens) / 1_000_000) * inputPer1M;
    const cachedInputCost =
      (prefixTokens / 1_000_000) * cachedInputPer1M +
      (perRequestInputTokens / 1_000_000) * inputPer1M;
    const withCaching =
      firstInputCost +
      cachedInputCost * (requestCount - 1) +
      (totalResponseTokens / 1_000_000) * outputPer1M;

    const savings = withoutCaching - withCaching;
    providers.push({
      provider: "Google (Gemini 1.5 Pro)",
      withoutCaching: Math.round(withoutCaching * 10000) / 10000,
      withCaching: Math.round(withCaching * 10000) / 10000,
      savings: Math.round(savings * 10000) / 10000,
      savingsPercent: Math.round((savings / withoutCaching) * 100),
    });
  }

  return providers;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║         Prompt Caching — Benchmark Demo                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // ── Setup info ──
  console.log(`  Model:              ${MODEL}`);
  console.log(`  System prompt:      ~${SYSTEM_PROMPT.split(/\s+/).length} words`);
  console.log(`  Tool definitions:   ${tools.length} tools`);
  console.log(`  Test questions:     ${TEST_QUESTIONS.length}`);

  // ── Warm up: load model into memory ──
  console.log("\n  Warming up model (first load is always slow)...");
  await ollama.chat({
    model: MODEL,
    messages: [{ role: "user", content: "Hello" }],
  });
  console.log("  Model ready.\n");

  // ── Phase 1: Stable prefix ──
  console.log("  ━━━ Phase 1: Stable Prefix (same system prompt every request) ━━━");
  console.log("  Ollama can reuse the KV-cache for the identical prompt prefix.\n");

  const stableRuns: BenchmarkRun[] = [];
  for (let i = 0; i < TEST_QUESTIONS.length; i++) {
    const question = TEST_QUESTIONS[i];
    process.stdout.write(`  Running request ${i + 1}/${TEST_QUESTIONS.length}...`);
    const metrics = await runBenchmarkRequest(question, SYSTEM_PROMPT);
    stableRuns.push({ label: `#${i + 1}`, question, metrics });
    console.log(` prompt_eval: ${metrics.promptTokens} tokens in ${metrics.promptEvalMs}ms`);
  }

  // ── Phase 2: Rotating prefix ──
  console.log("\n  ━━━ Phase 2: Rotating Prefix (system prompt changes each request) ━━━");
  console.log("  A different prompt each time invalidates the KV-cache.\n");

  const rotatingRuns: BenchmarkRun[] = [];
  for (let i = 0; i < TEST_QUESTIONS.length; i++) {
    const question = TEST_QUESTIONS[i];
    // Append a changing suffix to invalidate the cache
    const rotatedPrompt = `${SYSTEM_PROMPT}\n\n[Policy version: ${Date.now()}-${i}. Session ID: ${Math.random().toString(36).slice(2)}]`;
    process.stdout.write(`  Running request ${i + 1}/${TEST_QUESTIONS.length}...`);
    const metrics = await runBenchmarkRequest(question, rotatedPrompt);
    rotatingRuns.push({ label: `#${i + 1}`, question, metrics });
    console.log(` prompt_eval: ${metrics.promptTokens} tokens in ${metrics.promptEvalMs}ms`);
  }

  // ── Results ──
  const results: BenchmarkResult = {
    stablePrefix: stableRuns,
    rotatingPrefix: rotatingRuns,
  };

  printMetricsTable("Stable Prefix Results", results.stablePrefix);
  printMetricsTable("Rotating Prefix Results", results.rotatingPrefix);

  // ── Summary comparison ──
  const stableAvgPromptMs = avgMetric(results.stablePrefix, (m) => m.promptEvalMs);
  const rotatingAvgPromptMs = avgMetric(results.rotatingPrefix, (m) => m.promptEvalMs);
  const stableAvgPromptTokens = avgMetric(results.stablePrefix, (m) => m.promptTokens);
  const rotatingAvgPromptTokens = avgMetric(results.rotatingPrefix, (m) => m.promptTokens);

  // Compare runs 2-5 (cache-warm) vs rotating for clearer signal
  const warmStableRuns = results.stablePrefix.slice(1);
  const warmAvgPromptMs =
    warmStableRuns.length > 0
      ? avgMetric(warmStableRuns, (m) => m.promptEvalMs)
      : stableAvgPromptMs;
  const warmAvgPromptTokens =
    warmStableRuns.length > 0
      ? avgMetric(warmStableRuns, (m) => m.promptTokens)
      : stableAvgPromptTokens;

  console.log("\n  ━━━ Summary ━━━");
  console.log(
    `\n  Stable prefix  (all 5):     avg ${stableAvgPromptTokens} prompt tokens, ${stableAvgPromptMs}ms prompt eval`,
  );
  console.log(
    `  Stable prefix  (runs 2-5):  avg ${warmAvgPromptTokens} prompt tokens, ${warmAvgPromptMs}ms prompt eval`,
  );
  console.log(
    `  Rotating prefix (all 5):    avg ${rotatingAvgPromptTokens} prompt tokens, ${rotatingAvgPromptMs}ms prompt eval`,
  );

  if (warmAvgPromptMs < rotatingAvgPromptMs) {
    const speedup = Math.round((1 - warmAvgPromptMs / rotatingAvgPromptMs) * 100);
    console.log(`\n  Cache-warm requests are ~${speedup}% faster on prompt evaluation.`);
  } else {
    console.log(
      "\n  Note: KV-cache benefit may be small or variable depending on model and hardware.",
    );
  }

  // ── Cost comparison ──
  // Estimate prefix tokens from first stable run's prompt_eval_count
  const prefixTokens = results.stablePrefix[0]?.metrics.promptTokens ?? 2000;
  const avgResponseTokens = avgMetric(results.stablePrefix, (m) => m.responseTokens);

  // Scale to a realistic production scenario: 1000 requests
  const requestCount = 1000;
  const costs = calculateProviderCosts(prefixTokens, requestCount, avgResponseTokens);

  console.log(
    `\n  ━━━ Cloud Provider Cost Comparison (${requestCount.toLocaleString()} requests) ━━━`,
  );
  console.log(
    `  Prefix tokens: ~${prefixTokens} | Response tokens: ~${avgResponseTokens}/request\n`,
  );

  console.log(
    `  ${pad("Provider", 32)} ${pad("No Cache", 12)} ${pad("With Cache", 12)} ${pad("Savings", 10)} ${pad("%", 5)}`,
  );
  console.log(`  ${"─".repeat(71)}`);

  for (const cost of costs) {
    console.log(
      `  ${pad(cost.provider, 32)} $${pad(cost.withoutCaching.toFixed(4), 11)} $${pad(cost.withCaching.toFixed(4), 11)} $${pad(cost.savings.toFixed(4), 9)} ${cost.savingsPercent}%`,
    );
  }

  console.log(
    "\n  Note: Cost estimates use published per-token pricing. Actual costs depend on\n" +
      "  exact token counts, cache TTL, and request timing.\n",
  );
}

main().catch(console.error);
