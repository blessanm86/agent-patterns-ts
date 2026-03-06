// ─── Ordered Precondition Simulation Harness ─────────────────────────────────
//
// THE CORE PATTERN: a stateful simulation that intercepts tool calls and checks
// whether their preconditions have been met before counting them as valid.
//
// Standard trajectory evals ask: "Did the agent call the right tools?"
// This harness asks: "Did the agent call them in a logically valid order?"
//
// Architecture:
//
//   Tool Call → Precondition Check → State Update → Mock Response
//                    │                     │
//                    ▼                     ▼
//              Violation Log         Updated Flags
//
// Each tool has:
//   - preconditions: boolean flags that must be true before this call is valid
//   - postconditions: flags to set after successful execution
//   - mock response: what to return to the agent
//
// The harness tracks ALL calls (valid and invalid) and returns a detailed
// report for scoring.

import type { ToolExecutorFn } from "./agent.js";

// ─── Types ────────────────────────────────────────────────────────────────────

// A single precondition rule for a tool.
// The `flag` must be true in the simulation state before the tool call is valid.
export interface Precondition {
  flag: string;
  description: string;
}

// Defines how one tool participates in the simulation.
export interface ToolSimulationRule {
  // Flags that must be true before this tool call is valid
  preconditions: Precondition[];
  // Flags to set to true after this tool executes
  postconditions: string[];
  // Mock response to return to the agent
  mockResponse: (args: Record<string, string>) => string;
}

// A recorded tool call with its precondition evaluation result.
export interface RecordedCall {
  tool: string;
  args: Record<string, string>;
  valid: boolean;
  // Which preconditions were satisfied
  satisfiedPreconditions: string[];
  // Which preconditions were NOT satisfied (empty if valid)
  violatedPreconditions: string[];
  // Snapshot of state at time of call
  stateSnapshot: Record<string, boolean>;
}

// The full simulation report after an agent run.
export interface SimulationReport {
  calls: RecordedCall[];
  finalState: Record<string, boolean>;
  // Scoring
  totalCalls: number;
  validCalls: number;
  invalidCalls: number;
  // Precision: valid / total (did the agent avoid out-of-order calls?)
  precision: number;
  // Recall: valid / expected (did the agent complete all required steps?)
  recall: number;
  // The specific violations for debugging
  violations: Array<{
    tool: string;
    missingFlags: string[];
    description: string;
  }>;
}

// ─── Simulation Definitions ──────────────────────────────────────────────────

// The e-commerce order investigation dependency graph:
//
//   search_orders ──→ get_order_details ──→ check_shipping_status
//                            │
//                            └──→ process_refund

export function createOrderInvestigationRules(
  mockOverrides: Partial<Record<string, (args: Record<string, string>) => string>> = {},
): Record<string, ToolSimulationRule> {
  return {
    search_orders: {
      preconditions: [], // No preconditions — this is the entry point
      postconditions: ["orders_searched"],
      mockResponse:
        mockOverrides.search_orders ??
        (() =>
          JSON.stringify({
            found: true,
            orders: [
              {
                orderId: "ORD-1001",
                date: "2026-02-15",
                total: 115.97,
                status: "shipped",
                itemCount: 2,
              },
            ],
          })),
    },
    get_order_details: {
      preconditions: [
        { flag: "orders_searched", description: "Must search for orders before getting details" },
      ],
      postconditions: ["order_details_retrieved"],
      mockResponse:
        mockOverrides.get_order_details ??
        ((args) =>
          JSON.stringify({
            orderId: args.order_id ?? "ORD-1001",
            customerName: "Alice Chen",
            items: [
              { name: "Wireless Headphones", qty: 1, price: 89.99 },
              { name: "USB-C Cable", qty: 2, price: 12.99 },
            ],
            total: 115.97,
            status: "shipped",
            date: "2026-02-15",
          })),
    },
    check_shipping_status: {
      preconditions: [
        {
          flag: "order_details_retrieved",
          description: "Must get order details before checking shipping",
        },
      ],
      postconditions: ["shipping_checked"],
      mockResponse:
        mockOverrides.check_shipping_status ??
        ((args) =>
          JSON.stringify({
            orderId: args.order_id ?? "ORD-1001",
            carrier: "FedEx",
            trackingNumber: "FX-789456123",
            status: "in_transit",
            estimatedDelivery: "2026-03-08",
            lastUpdate: "Package departed Memphis hub",
          })),
    },
    process_refund: {
      preconditions: [
        {
          flag: "order_details_retrieved",
          description: "Must get order details before processing refund",
        },
      ],
      postconditions: ["refund_processed"],
      mockResponse:
        mockOverrides.process_refund ??
        ((args) =>
          JSON.stringify({
            success: true,
            refundId: "REF-SIM-001",
            orderId: args.order_id ?? "ORD-1001",
            amount: 115.97,
            reason: args.reason ?? "customer request",
            status: "processing",
          })),
    },
  };
}

// ─── createSimulationExecutor ────────────────────────────────────────────────
//
// Creates a ToolExecutorFn that:
//   1. Intercepts every tool call
//   2. Checks preconditions against current state
//   3. Records the call as valid or invalid
//   4. Updates state with postconditions (even for invalid calls — the agent
//      still receives a response so it can continue)
//   5. Returns the mock response
//
// After the agent run, call getReport() to get the full simulation analysis.

export function createSimulationExecutor(
  rules: Record<string, ToolSimulationRule>,
  expectedTools: string[],
): { executor: ToolExecutorFn; getReport: () => SimulationReport } {
  const state: Record<string, boolean> = {};
  const calls: RecordedCall[] = [];
  const violations: SimulationReport["violations"] = [];

  const executor: ToolExecutorFn = (name: string, args: Record<string, string>): string => {
    const rule = rules[name];

    if (!rule) {
      // Unknown tool — record but don't crash
      calls.push({
        tool: name,
        args,
        valid: false,
        satisfiedPreconditions: [],
        violatedPreconditions: ["unknown_tool"],
        stateSnapshot: { ...state },
      });
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    // Check preconditions
    const satisfied: string[] = [];
    const violated: string[] = [];

    for (const pre of rule.preconditions) {
      if (state[pre.flag]) {
        satisfied.push(pre.flag);
      } else {
        violated.push(pre.flag);
        violations.push({
          tool: name,
          missingFlags: [pre.flag],
          description: pre.description,
        });
      }
    }

    const valid = violated.length === 0;

    calls.push({
      tool: name,
      args,
      valid,
      satisfiedPreconditions: satisfied,
      violatedPreconditions: violated,
      stateSnapshot: { ...state },
    });

    // Update state — always, so the agent can continue
    for (const flag of rule.postconditions) {
      state[flag] = true;
    }

    return rule.mockResponse(args);
  };

  const getReport = (): SimulationReport => {
    const totalCalls = calls.length;
    const validCalls = calls.filter((c) => c.valid).length;
    const invalidCalls = totalCalls - validCalls;

    // Recall: how many of the expected tools were called validly?
    const validToolNames = new Set(calls.filter((c) => c.valid).map((c) => c.tool));
    const expectedHits = expectedTools.filter((t) => validToolNames.has(t)).length;

    return {
      calls,
      finalState: { ...state },
      totalCalls,
      validCalls,
      invalidCalls,
      precision: totalCalls > 0 ? validCalls / totalCalls : 0,
      recall: expectedTools.length > 0 ? expectedHits / expectedTools.length : 1,
      violations,
    };
  };

  return { executor, getReport };
}
