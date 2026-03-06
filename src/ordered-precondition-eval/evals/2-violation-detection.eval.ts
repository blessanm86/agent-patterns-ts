// ─── Eval 2: Violation Detection — Deliberately Out-of-Order Agent ───────────
//
// This eval tests the HARNESS itself, not the agent.
// We create a mock executor that simulates an agent calling tools out of order,
// then verify the harness correctly detects and scores the violations.
//
// Why test the harness? A precondition evaluator that can't detect violations
// is worse than no evaluator at all — it gives false confidence.

import { evalite, createScorer } from "evalite";
import {
  createSimulationExecutor,
  createOrderInvestigationRules,
  type SimulationReport,
} from "../simulation.js";

// ─── Helper: Simulate a tool call sequence directly ──────────────────────────
//
// Instead of running the LLM, we call the executor directly with a known
// sequence. This makes the test deterministic — no model variance.

function simulateSequence(
  toolCalls: Array<{ tool: string; args: Record<string, string> }>,
  expectedTools: string[],
): SimulationReport {
  const rules = createOrderInvestigationRules();
  const { executor, getReport } = createSimulationExecutor(rules, expectedTools);

  for (const call of toolCalls) {
    executor(call.tool, call.args);
  }

  return getReport();
}

// ─── Test 1: Correct Order → Perfect Score ───────────────────────────────────

evalite("Violation detection — correct order scores 100%", {
  data: async () => [{ input: "correct-order" }],
  task: async () => {
    return simulateSequence(
      [
        { tool: "search_orders", args: { customer_name: "Alice Chen" } },
        { tool: "get_order_details", args: { order_id: "ORD-1001" } },
        { tool: "check_shipping_status", args: { order_id: "ORD-1001" } },
      ],
      ["search_orders", "get_order_details", "check_shipping_status"],
    );
  },
  scorers: [
    createScorer<string, SimulationReport>({
      name: "Precision = 1.0",
      scorer: ({ output }) => (output.precision === 1 ? 1 : 0),
    }),
    createScorer<string, SimulationReport>({
      name: "Recall = 1.0",
      scorer: ({ output }) => (output.recall === 1 ? 1 : 0),
    }),
    createScorer<string, SimulationReport>({
      name: "Zero violations",
      scorer: ({ output }) => (output.violations.length === 0 ? 1 : 0),
    }),
  ],
});

// ─── Test 2: Skip Search → get_order_details Flagged ─────────────────────────
//
// The agent calls get_order_details without first calling search_orders.
// The harness should flag this as a violation.

evalite("Violation detection — skipped search flagged", {
  data: async () => [{ input: "skipped-search" }],
  task: async () => {
    return simulateSequence(
      [
        // Skip search_orders entirely!
        { tool: "get_order_details", args: { order_id: "ORD-1001" } },
        { tool: "check_shipping_status", args: { order_id: "ORD-1001" } },
      ],
      ["search_orders", "get_order_details", "check_shipping_status"],
    );
  },
  scorers: [
    createScorer<string, SimulationReport>({
      name: "get_order_details flagged invalid",
      scorer: ({ output }) => {
        const detailsCall = output.calls.find((c) => c.tool === "get_order_details");
        return detailsCall && !detailsCall.valid ? 1 : 0;
      },
    }),
    createScorer<string, SimulationReport>({
      name: "Precision < 1.0",
      scorer: ({ output }) => (output.precision < 1 ? 1 : 0),
    }),
    createScorer<string, SimulationReport>({
      name: "Recall < 1.0 (search missing)",
      scorer: ({ output }) => (output.recall < 1 ? 1 : 0),
    }),
    createScorer<string, SimulationReport>({
      name: "Violation mentions orders_searched",
      scorer: ({ output }) =>
        output.violations.some((v) => v.missingFlags.includes("orders_searched")) ? 1 : 0,
    }),
  ],
});

// ─── Test 3: Skip to Refund → Two Violations ────────────────────────────────
//
// The agent jumps straight to process_refund without search or details.
// This should produce a violation on process_refund (missing order_details_retrieved).

evalite("Violation detection — direct refund flagged", {
  data: async () => [{ input: "direct-refund" }],
  task: async () => {
    return simulateSequence(
      [{ tool: "process_refund", args: { order_id: "ORD-1001", reason: "defective" } }],
      ["search_orders", "get_order_details", "process_refund"],
    );
  },
  scorers: [
    createScorer<string, SimulationReport>({
      name: "Refund flagged invalid",
      scorer: ({ output }) => {
        const refundCall = output.calls.find((c) => c.tool === "process_refund");
        return refundCall && !refundCall.valid ? 1 : 0;
      },
    }),
    createScorer<string, SimulationReport>({
      name: "Precision = 0% (all calls invalid)",
      scorer: ({ output }) => (output.precision === 0 ? 1 : 0),
    }),
    createScorer<string, SimulationReport>({
      name: "Low recall (missing search + details)",
      scorer: ({ output }) => (output.recall <= 1 / 3 ? 1 : 0),
    }),
  ],
});

// ─── Test 4: Correct Order but Extra Calls → Precision Drops ─────────────────
//
// The agent calls tools in the right order but also calls an unknown tool.
// Precision should drop because there's an invalid call in the mix.

evalite("Violation detection — extra unknown tool reduces precision", {
  data: async () => [{ input: "extra-tool" }],
  task: async () => {
    return simulateSequence(
      [
        { tool: "search_orders", args: { customer_name: "Alice Chen" } },
        { tool: "get_order_details", args: { order_id: "ORD-1001" } },
        { tool: "nonexistent_tool", args: {} },
        { tool: "check_shipping_status", args: { order_id: "ORD-1001" } },
      ],
      ["search_orders", "get_order_details", "check_shipping_status"],
    );
  },
  scorers: [
    createScorer<string, SimulationReport>({
      name: "3 valid + 1 invalid = precision 75%",
      scorer: ({ output }) => (output.precision === 0.75 ? 1 : 0),
    }),
    createScorer<string, SimulationReport>({
      name: "Recall still 100% (all expected tools called validly)",
      scorer: ({ output }) => (output.recall === 1 ? 1 : 0),
    }),
  ],
});
