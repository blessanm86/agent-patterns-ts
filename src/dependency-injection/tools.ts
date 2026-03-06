import type { ToolDefinition } from "../shared/types.js";
import type { RunContext, Deps } from "./context.js";
import { getLoyaltyMultiplier } from "./context.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────
//
// These tell the model WHAT tools exist. Notice: nothing about user IDs,
// database connections, or loggers — those are injected via RunContext.

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "lookup_order",
      description:
        "Look up a specific order by its order ID. Returns order details including items, total, and status. The order must belong to the current user.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to look up (e.g. ORD-1001)",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_orders",
      description:
        "List the current user's recent orders. Returns up to 5 orders with their IDs, dates, totals, and statuses.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "string",
            description: "Maximum number of orders to return (default: 5)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "process_refund",
      description:
        "Process a refund for a delivered or shipped order. Cannot refund pending orders. Returns a refund confirmation with refund ID.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to refund",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_loyalty_points",
      description:
        "Check the current user's loyalty points balance. Points are earned from past orders and multiplied by membership tier.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ─── Tool Implementations ───────────────────────────────────────────────────
//
// Every tool receives RunContext<Deps> as its SECOND argument (after args).
// This is the key DI pattern: tools access typed dependencies without the
// LLM knowing they exist.

function lookupOrder(args: { order_id: string }, ctx: RunContext<Deps>): string {
  const { db, user, logger } = ctx.deps;

  logger.info("Looking up order", { orderId: args.order_id, userId: user.id });

  const order = db.getOrderById(args.order_id);
  if (!order) {
    return JSON.stringify({ error: `Order ${args.order_id} not found` });
  }

  // User scoping: can only see your own orders
  if (order.userId !== user.id) {
    logger.warn("User attempted to access another user's order", {
      orderId: args.order_id,
      requestingUser: user.id,
      ownerUser: order.userId,
    });
    return JSON.stringify({ error: `Order ${args.order_id} not found` });
  }

  return JSON.stringify({
    id: order.id,
    items: order.items,
    total: order.total,
    status: order.status,
    date: order.date,
  });
}

function listRecentOrders(args: { limit?: string }, ctx: RunContext<Deps>): string {
  const { db, user, logger } = ctx.deps;
  const limit = parseInt(args.limit ?? "5", 10) || 5;

  logger.info("Listing recent orders", { userId: user.id, limit });

  const orders = db.getOrdersByUser(user.id);
  const recent = orders.slice(-limit);

  return JSON.stringify({
    orders: recent.map((o) => ({
      id: o.id,
      date: o.date,
      total: o.total,
      status: o.status,
      itemCount: o.items.length,
    })),
    totalOrders: orders.length,
  });
}

function processRefund(args: { order_id: string }, ctx: RunContext<Deps>): string {
  const { db, user, logger } = ctx.deps;

  // Verify ownership first
  const order = db.getOrderById(args.order_id);
  if (!order || order.userId !== user.id) {
    logger.warn("Refund attempted on inaccessible order", {
      orderId: args.order_id,
      userId: user.id,
    });
    return JSON.stringify({ error: `Order ${args.order_id} not found` });
  }

  logger.info("Processing refund", {
    orderId: args.order_id,
    userId: user.id,
    amount: order.total,
  });

  const result = db.processRefund(args.order_id);

  if (result.success) {
    logger.info("Refund processed successfully", {
      orderId: args.order_id,
      refundId: result.refundId,
      amount: order.total,
    });
  } else {
    logger.warn("Refund failed", { orderId: args.order_id, error: result.error });
  }

  return JSON.stringify(result);
}

function checkLoyaltyPoints(_args: Record<string, never>, ctx: RunContext<Deps>): string {
  const { db, user, logger } = ctx.deps;

  const basePoints = db.getLoyaltyPoints(user.id);
  const multiplier = getLoyaltyMultiplier(user.tier);
  const totalPoints = Math.floor(basePoints * multiplier);

  logger.info("Loyalty points checked", {
    userId: user.id,
    tier: user.tier,
    basePoints,
    multiplier,
    totalPoints,
  });

  return JSON.stringify({
    tier: user.tier,
    basePoints,
    multiplier: `${multiplier}x`,
    totalPoints,
    nextTier:
      user.tier === "standard"
        ? "premium (500+ points)"
        : user.tier === "premium"
          ? "vip (1000+ points)"
          : "max tier reached",
  });
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────
//
// The key change from the base pattern: executeTool now takes a RunContext
// as its third argument. The dispatcher threads it to every tool.

export function executeTool(
  name: string,
  args: Record<string, string>,
  ctx: RunContext<Deps>,
): string {
  ctx.toolCallCount++;

  switch (name) {
    case "lookup_order":
      return lookupOrder(args as { order_id: string }, ctx);
    case "list_recent_orders":
      return listRecentOrders(args as { limit?: string }, ctx);
    case "process_refund":
      return processRefund(args as { order_id: string }, ctx);
    case "check_loyalty_points":
      return checkLoyaltyPoints(args as Record<string, never>, ctx);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
