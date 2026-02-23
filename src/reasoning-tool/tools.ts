import type { ToolDefinition, Order, RefundRecord } from "./types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────
//
// Four tools total:
//   1. think       — no-op; forces structured reasoning before each action
//   2. lookup_order         — fetch order details by ID
//   3. check_refund_policy  — evaluate eligibility given age and amount
//   4. process_refund       — record the final decision

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "think",
      description:
        "Use this tool BEFORE every other tool call to reason about what to do next. " +
        "Capture your reasoning in 'thought'. Set 'should_continue' to true if you need " +
        "to take another action, or false if you have enough information to give a final answer.",
      parameters: {
        type: "object",
        properties: {
          thought: {
            type: "string",
            description: "Your step-by-step reasoning about the current situation and next action",
          },
          should_continue: {
            type: "string",
            description:
              'Set to "true" if you need to call another tool, "false" if you are ready to give your final answer',
            enum: ["true", "false"],
          },
        },
        required: ["thought", "should_continue"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_order",
      description:
        "Look up an order by its ID. Returns order details including item, amount, purchase date, and customer name.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to look up (e.g. ORD-001)",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_refund_policy",
      description:
        "Check whether a refund is eligible based on policy rules. Returns eligibility status, reason, and whether manager approval is required.",
      parameters: {
        type: "object",
        properties: {
          days_since_purchase: {
            type: "string",
            description: "How many days ago the item was purchased",
          },
          amount: {
            type: "string",
            description: "The purchase amount in dollars",
          },
        },
        required: ["days_since_purchase", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "process_refund",
      description:
        "Record the final refund decision for an order. Call this after checking policy to record whether the refund was approved or denied.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to process the refund for",
          },
          approved: {
            type: "string",
            description: 'Whether the refund is approved: "true" or "false"',
            enum: ["true", "false"],
          },
          reason: {
            type: "string",
            description: "The reason for the approval or denial",
          },
        },
        required: ["order_id", "approved", "reason"],
      },
    },
  },
];

// ─── Mock Data ────────────────────────────────────────────────────────────────
//
// Today is 2026-02-23. Days since purchase calculated from that date.
// ORD-001: 13 days old,  $89   → eligible, auto-approve
// ORD-002: 44 days old,  $220  → ineligible, too old
// ORD-003: 3 days old,   $45   → eligible, auto-approve
// ORD-004: 8 days old,   $580  → eligible but high-value, flag for manager

const MOCK_ORDERS: Record<string, Order> = {
  "ORD-001": {
    orderId: "ORD-001",
    customerName: "Sarah Chen",
    item: "Laptop Stand",
    amount: 89,
    purchaseDate: "2026-02-10",
    status: "active",
  },
  "ORD-002": {
    orderId: "ORD-002",
    customerName: "James Liu",
    item: "Mechanical Keyboard",
    amount: 220,
    purchaseDate: "2026-01-10",
    status: "active",
  },
  "ORD-003": {
    orderId: "ORD-003",
    customerName: "Maria Santos",
    item: "USB-C Hub",
    amount: 45,
    purchaseDate: "2026-02-20",
    status: "active",
  },
  "ORD-004": {
    orderId: "ORD-004",
    customerName: "David Park",
    item: "Monitor Arm",
    amount: 580,
    purchaseDate: "2026-02-15",
    status: "active",
  },
};

// In-memory store for processed refunds
const PROCESSED_REFUNDS: RefundRecord[] = [];

// ─── Tool Implementations ─────────────────────────────────────────────────────

function lookupOrder(args: { order_id: string }): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({ error: `Order ${args.order_id} not found` });
  }

  // Calculate days since purchase from the fixed "today" date
  const today = new Date("2026-02-23");
  const purchased = new Date(order.purchaseDate);
  const daysSince = Math.floor((today.getTime() - purchased.getTime()) / (1000 * 60 * 60 * 24));

  return JSON.stringify({ ...order, daysSincePurchase: daysSince });
}

function checkRefundPolicy(args: { days_since_purchase: string; amount: string }): string {
  const days = parseInt(args.days_since_purchase, 10);
  const amount = parseFloat(args.amount);

  if (days > 30) {
    return JSON.stringify({
      eligible: false,
      reason: `Purchase was ${days} days ago. Refunds are only accepted within 30 days of purchase.`,
      requiresManagerApproval: false,
    });
  }

  if (amount > 500) {
    return JSON.stringify({
      eligible: true,
      reason: `Purchase is within the 30-day window, but the amount ($${amount}) exceeds $500. Manager approval required.`,
      requiresManagerApproval: true,
    });
  }

  return JSON.stringify({
    eligible: true,
    reason: `Purchase is within the 30-day return window and under the $500 threshold. Auto-approved.`,
    requiresManagerApproval: false,
  });
}

function processRefund(args: { order_id: string; approved: string; reason: string }): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({ error: `Order ${args.order_id} not found` });
  }

  const approved = args.approved === "true";
  const record: RefundRecord = {
    refundId: `REF-${Date.now()}`,
    orderId: args.order_id,
    approved,
    reason: args.reason,
    processedAt: new Date().toISOString(),
  };

  PROCESSED_REFUNDS.push(record);

  if (approved) {
    order.status = "refunded";
  }

  return JSON.stringify({
    success: true,
    refundId: record.refundId,
    approved,
    reason: args.reason,
  });
}

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "think":
      // No-op — the value is the structured thought in the message history,
      // not any side effect. We return a simple acknowledgement.
      return "Thought recorded.";
    case "lookup_order":
      return lookupOrder(args as Parameters<typeof lookupOrder>[0]);
    case "check_refund_policy":
      return checkRefundPolicy(args as Parameters<typeof checkRefundPolicy>[0]);
    case "process_refund":
      return processRefund(args as Parameters<typeof processRefund>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
