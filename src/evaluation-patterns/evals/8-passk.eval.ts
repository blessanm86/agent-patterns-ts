// ─── Pattern 8: Pass^k Reliability Evals ─────────────────────────────────────
//
// Pass^k measures how reliably an agent succeeds across K independent runs —
// not just "did it pass once?" but "what fraction of K runs pass?"
//
// Why this matters:
//   LLMs are non-deterministic. Even at temperature=0, floating-point
//   differences and batching mean the same prompt can produce different
//   tool sequences on different runs. A score of 1/1 might be a fluke.
//   A score of 5/5 means the agent is genuinely reliable.
//
// From τ-bench (Yao et al., 2024):
//   gpt-4o achieves <50% pass^1 and <25% pass^8 on retail agent tasks.
//   Reliability degrades sharply as task complexity increases.
//   This is why production systems need pass^k, not just pass^1.
//
// Configuration:
//   K defaults to 3 to balance coverage vs. speed.
//   Increase for a more thorough reliability check:
//     EVAL_K=5 pnpm eval
//
// Interpretation:
//   pass_rate = 1.0 → reliable
//   pass_rate = 0.67 → passes most of the time, worth investigating
//   pass_rate ≤ 0.33 → unreliable — model or prompt needs work

import { evalite, createScorer } from "evalite";
import { runHotelAgent } from "../agent.js";
import { extractToolCallNames } from "../../react/eval-utils.js";
import { createMockExecutor, scenarios } from "../fixtures/mock-tools.js";

const K = Number(process.env.EVAL_K ?? "3");

// ─── runKTimes ────────────────────────────────────────────────────────────────
//
// Runs the agent K times on the same input with a fresh mock executor each time.
// Returns pass rate and per-run results for debugging.

interface PassKResult {
  passed: number;
  total: number;
  passRate: number;
  runs: boolean[];
}

async function runKTimes(
  input: string,
  k: number,
  passFn: (tools: string[]) => boolean,
): Promise<PassKResult> {
  const runs: boolean[] = [];

  for (let i = 0; i < k; i++) {
    // Fresh executor per run — mock state (e.g. makeFailThenSucceed counters)
    // must not carry over between runs
    const executor = createMockExecutor(scenarios.onlySuiteAvailable);
    const history = await runHotelAgent(input, [], { executorFn: executor });
    const tools = extractToolCallNames(history);
    runs.push(passFn(tools));
  }

  const passed = runs.filter(Boolean).length;
  return { passed, total: k, passRate: passed / k, runs };
}

// ─── Test 1: Full booking consistency ─────────────────────────────────────────
//
// This is a straightforward booking request with all info provided.
// A reliable agent should complete the full tool sequence every run.
// If pass_rate < 1.0, the model has non-determinism at even simple tasks.

evalite(`Pass^k — full booking consistency (k=${K})`, {
  data: async () => [
    { input: "My name is Ivan Zhao. Book a suite from 2026-07-01 to 2026-07-04." },
  ],
  task: async (input) => {
    return runKTimes(
      input,
      K,
      (tools) =>
        tools.includes("check_availability") &&
        tools.includes("get_room_price") &&
        tools.includes("create_reservation"),
    );
  },
  scorers: [
    createScorer<string, PassKResult>({
      name: `Pass rate (k=${K})`,
      // Continuous score: 3/3 = 1.0, 2/3 ≈ 0.67, 1/3 ≈ 0.33
      scorer: ({ output }) => output.passRate,
    }),
    createScorer<string, PassKResult>({
      name: "All runs passed",
      // Binary: did it pass every single run? More demanding than pass rate.
      scorer: ({ output }) => (output.passed === output.total ? 1 : 0),
    }),
  ],
});

// ─── Test 2: Browse-only consistency ─────────────────────────────────────────
//
// A browsing query must consistently NOT create reservations.
// Inconsistency here is a serious problem — the agent sometimes books
// when the user only asked to look. Pass^k catches this better than pass^1.

evalite(`Pass^k — browse-only consistency (k=${K})`, {
  data: async () => [
    { input: "What rooms do you have from 2026-08-01 to 2026-08-04? Just browsing." },
  ],
  task: async (input) => {
    return runKTimes(
      input,
      K,
      (tools) => tools.includes("check_availability") && !tools.includes("create_reservation"),
    );
  },
  scorers: [
    createScorer<string, PassKResult>({
      name: `Pass rate (k=${K})`,
      scorer: ({ output }) => output.passRate,
    }),
    createScorer<string, PassKResult>({
      name: "All runs passed",
      scorer: ({ output }) => (output.passed === output.total ? 1 : 0),
    }),
  ],
});
