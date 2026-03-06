// ─── Eval 1: Ordered Precondition — Happy Path vs. Presence-Only ──────────────
//
// THE KEY COMPARISON: This eval runs the same agent task twice —
// once scored with simple presence-based checking (did it call the right tools?)
// and once scored with the precondition simulation harness (did it call them
// in the right ORDER?).
//
// An agent that calls get_order_details before search_orders would pass
// presence-based eval but fail precondition eval. That's the point.

import { evalite, createScorer } from "evalite";
import { runOrderAgent } from "../agent.js";
import { extractToolCallNames } from "../../react/eval-utils.js";
import {
  createSimulationExecutor,
  createOrderInvestigationRules,
  type SimulationReport,
} from "../simulation.js";

// ─── Test 1: Shipping Inquiry (Full Chain) ───────────────────────────────────
//
// Expected chain: search_orders → get_order_details → check_shipping_status
// The precondition harness verifies each step's prerequisites are met.

evalite("Precondition — shipping inquiry (full chain)", {
  data: async () => [
    {
      input: "Hi, I'm Alice Chen. Where is my order? I want to track shipping.",
    },
  ],
  task: async (input) => {
    const expectedTools = ["search_orders", "get_order_details", "check_shipping_status"];
    const rules = createOrderInvestigationRules();
    const { executor, getReport } = createSimulationExecutor(rules, expectedTools);

    const history = await runOrderAgent(input, [], { executorFn: executor });
    const toolNames = extractToolCallNames(history);
    const report = getReport();

    return { toolNames, report };
  },
  scorers: [
    // Presence-based: did it call all three tools?
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "Presence — all tools called",
      scorer: ({ output }) =>
        ["search_orders", "get_order_details", "check_shipping_status"].every((t) =>
          output.toolNames.includes(t),
        )
          ? 1
          : 0,
    }),

    // Order-based: were all calls valid (preconditions met)?
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "Precondition — all calls valid",
      scorer: ({ output }) => (output.report.invalidCalls === 0 ? 1 : 0),
    }),

    // Precision score (continuous)
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "Precondition — precision",
      scorer: ({ output }) => output.report.precision,
    }),

    // Recall score (continuous)
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "Precondition — recall",
      scorer: ({ output }) => output.report.recall,
    }),
  ],
});

// ─── Test 2: Refund Request (Fork in Dependency Graph) ───────────────────────
//
// Expected chain: search_orders → get_order_details → process_refund
// Tests the other branch of the dependency graph.

evalite("Precondition — refund request", {
  data: async () => [
    {
      input:
        "I'm Alice Chen and I want a refund for my headphones order. The product was defective.",
    },
  ],
  task: async (input) => {
    const expectedTools = ["search_orders", "get_order_details", "process_refund"];
    const rules = createOrderInvestigationRules();
    const { executor, getReport } = createSimulationExecutor(rules, expectedTools);

    const history = await runOrderAgent(input, [], { executorFn: executor });
    const toolNames = extractToolCallNames(history);
    const report = getReport();

    return { toolNames, report };
  },
  scorers: [
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "Presence — all tools called",
      scorer: ({ output }) =>
        ["search_orders", "get_order_details", "process_refund"].every((t) =>
          output.toolNames.includes(t),
        )
          ? 1
          : 0,
    }),
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "Precondition — all calls valid",
      scorer: ({ output }) => (output.report.invalidCalls === 0 ? 1 : 0),
    }),
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "Precondition — precision",
      scorer: ({ output }) => output.report.precision,
    }),
  ],
});

// ─── Test 3: Browse Only (Partial Chain) ─────────────────────────────────────
//
// Expected: search_orders → get_order_details (no shipping or refund)
// Tests that the harness handles partial chains correctly.

evalite("Precondition — browse only (partial chain)", {
  data: async () => [
    {
      input: "Can you look up recent orders for Alice Chen? Just checking status.",
    },
  ],
  task: async (input) => {
    const expectedTools = ["search_orders", "get_order_details"];
    const rules = createOrderInvestigationRules();
    const { executor, getReport } = createSimulationExecutor(rules, expectedTools);

    const history = await runOrderAgent(input, [], { executorFn: executor });
    const toolNames = extractToolCallNames(history);
    const report = getReport();

    return { toolNames, report };
  },
  scorers: [
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "Presence — search + details called",
      scorer: ({ output }) =>
        output.toolNames.includes("search_orders") && output.toolNames.includes("get_order_details")
          ? 1
          : 0,
    }),
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "Precondition — all calls valid",
      scorer: ({ output }) => (output.report.invalidCalls === 0 ? 1 : 0),
    }),
    createScorer<string, { toolNames: string[]; report: SimulationReport }>({
      name: "No refund processed",
      scorer: ({ output }) => (output.toolNames.includes("process_refund") ? 0 : 1),
    }),
  ],
});
