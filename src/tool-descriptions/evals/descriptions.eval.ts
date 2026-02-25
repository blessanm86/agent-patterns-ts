// ─── Tool Description Engineering Evals ──────────────────────────────────────
//
// Each of the 4 scenarios runs against BOTH weakTools and strongTools.
// The score difference between "Weak" and "Strong" is the argument for
// investing time in description quality.
//
// Scenarios target specific failure modes that weak descriptions cause:
//   1. Param name ambiguity  — "customer" vs "customer_email"
//   2. Missing call order    — jumping to issue_refund without get_order_details
//   3. Already-refunded edge — attempting to refund an already-refunded order
//   4. Over-escalation       — escalating a simple question

import { evalite, createScorer } from "evalite";
import { runAgent } from "../agent.js";
import { weakTools, strongTools } from "../tools.js";
import { extractToolCallNames, extractToolCalls } from "../../react/eval-utils.js";
import type { ToolCall } from "../../shared/types.js";

// ─── Scenario 1: Parameter Name Ambiguity ─────────────────────────────────────
//
// The user provides a customer NAME not an email.
// Weak: "customer" param — model likely passes "John Smith" directly and the
//   search_orders call fails with a confusing error or wrong result.
// Strong: "customer_email" param + description says "do NOT pass a name" —
//   model should ask for the email or handle the mismatch clearly.

evalite("Weak — param ambiguity (name instead of email)", {
  data: async () => [{ input: "I want a refund for customer John Smith on order ORD-001." }],
  task: async (input) => {
    const history = await runAgent(input, [], weakTools);
    return extractToolCalls(history);
  },
  scorers: [
    createScorer<string, ToolCall[]>({
      name: "search_orders received a valid email",
      scorer: ({ output }) => {
        const searchCall = output.find((tc: ToolCall) => tc.function.name === "search_orders");
        if (!searchCall) return 1; // didn't call search at all — no ambiguity triggered
        const val =
          searchCall.function.arguments.customer ??
          searchCall.function.arguments.customer_email ??
          "";
        return val.includes("@") ? 1 : 0;
      },
    }),
  ],
});

evalite("Strong — param ambiguity (name instead of email)", {
  data: async () => [{ input: "I want a refund for customer John Smith on order ORD-001." }],
  task: async (input) => {
    const history = await runAgent(input, [], strongTools);
    return extractToolCalls(history);
  },
  scorers: [
    createScorer<string, ToolCall[]>({
      name: "search_orders received a valid email",
      scorer: ({ output }) => {
        const searchCall = output.find((tc: ToolCall) => tc.function.name === "search_orders");
        if (!searchCall) return 1;
        const val =
          searchCall.function.arguments.customer ??
          searchCall.function.arguments.customer_email ??
          "";
        return val.includes("@") ? 1 : 0;
      },
    }),
  ],
});

// ─── Scenario 2: Missing Call Order ───────────────────────────────────────────
//
// Weak: no precondition stated — model may jump directly to issue_refund
//   without calling get_order_details first.
// Strong: description says "Always call get_order_details BEFORE issue_refund" —
//   model should look up the order first.

evalite("Weak — call order (get_order_details before issue_refund)", {
  data: async () => [{ input: "Please process a refund for order ORD-001." }],
  task: async (input) => {
    const history = await runAgent(input, [], weakTools);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "get_order_details called before issue_refund",
      scorer: ({ output }) => {
        const detailsIdx = output.indexOf("get_order_details");
        const refundIdx = output.indexOf("issue_refund");
        if (detailsIdx === -1 || refundIdx === -1) return 0;
        return detailsIdx < refundIdx ? 1 : 0;
      },
    }),
  ],
});

evalite("Strong — call order (get_order_details before issue_refund)", {
  data: async () => [{ input: "Please process a refund for order ORD-001." }],
  task: async (input) => {
    const history = await runAgent(input, [], strongTools);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "get_order_details called before issue_refund",
      scorer: ({ output }) => {
        const detailsIdx = output.indexOf("get_order_details");
        const refundIdx = output.indexOf("issue_refund");
        if (detailsIdx === -1 || refundIdx === -1) return 0;
        return detailsIdx < refundIdx ? 1 : 0;
      },
    }),
  ],
});

// ─── Scenario 3: Already-Refunded Edge Case ───────────────────────────────────
//
// ORD-002 is already refunded. Calling issue_refund on it is an error.
// Weak: no edge case documented — model may attempt issue_refund anyway.
// Strong: "Do NOT call if status is already 'refunded'" — model should
//   detect the status and skip issue_refund.

evalite("Weak — edge case (already refunded order ORD-002)", {
  data: async () => [{ input: "I want another refund on my order ORD-002." }],
  task: async (input) => {
    const history = await runAgent(input, [], weakTools);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "issue_refund NOT called on already-refunded order",
      scorer: ({ output }) => (output.includes("issue_refund") ? 0 : 1),
    }),
  ],
});

evalite("Strong — edge case (already refunded order ORD-002)", {
  data: async () => [{ input: "I want another refund on my order ORD-002." }],
  task: async (input) => {
    const history = await runAgent(input, [], strongTools);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "issue_refund NOT called on already-refunded order",
      scorer: ({ output }) => (output.includes("issue_refund") ? 0 : 1),
    }),
  ],
});

// ─── Scenario 4: Over-Escalation ──────────────────────────────────────────────
//
// The user has a simple informational question — no escalation needed.
// Weak: escalate_to_human has no "when not to use" guidance — model may
//   over-trigger it for any mention of needing help.
// Strong: "Do NOT use for routine questions — use send_message instead" —
//   model should handle it directly without escalating.

evalite("Weak — over-escalation (simple question)", {
  data: async () => [{ input: "I just have a quick question about what's in my order ORD-003." }],
  task: async (input) => {
    const history = await runAgent(input, [], weakTools);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "escalate_to_human NOT triggered for simple question",
      scorer: ({ output }) => (output.includes("escalate_to_human") ? 0 : 1),
    }),
  ],
});

evalite("Strong — over-escalation (simple question)", {
  data: async () => [{ input: "I just have a quick question about what's in my order ORD-003." }],
  task: async (input) => {
    const history = await runAgent(input, [], strongTools);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "escalate_to_human NOT triggered for simple question",
      scorer: ({ output }) => (output.includes("escalate_to_human") ? 0 : 1),
    }),
  ],
});
