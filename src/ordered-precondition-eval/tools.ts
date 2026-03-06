import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────
//
// E-commerce order investigation tools with natural dependency ordering:
//
//   search_orders ──→ get_order_details ──→ check_shipping_status
//                            │
//                            └──→ process_refund
//
// You must search for orders before getting details (need an order ID).
// You must get details before checking shipping or processing a refund.

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_orders",
      description:
        "Search for customer orders by name or email. Returns a list of matching order IDs with summary info.",
      parameters: {
        type: "object",
        properties: {
          customer_name: {
            type: "string",
            description: "Customer name to search for",
          },
          email: {
            type: "string",
            description: "Customer email to search for",
          },
        },
        required: ["customer_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_details",
      description:
        "Get full details for a specific order including items, prices, and status. Requires a valid order ID from search_orders.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to look up",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_shipping_status",
      description:
        "Check the shipping and delivery status for an order. Requires the order to have been looked up first via get_order_details.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to check shipping for",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "process_refund",
      description:
        "Process a refund for an order. Requires the order to have been looked up first via get_order_details to verify eligibility.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to refund",
          },
          reason: {
            type: "string",
            description: "Reason for the refund",
          },
        },
        required: ["order_id", "reason"],
      },
    },
  },
];

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_ORDERS = [
  {
    orderId: "ORD-1001",
    customerName: "Alice Chen",
    email: "alice@example.com",
    items: [
      { name: "Wireless Headphones", qty: 1, price: 89.99 },
      { name: "USB-C Cable", qty: 2, price: 12.99 },
    ],
    total: 115.97,
    status: "shipped",
    date: "2026-02-15",
  },
  {
    orderId: "ORD-1002",
    customerName: "Alice Chen",
    email: "alice@example.com",
    items: [{ name: "Mechanical Keyboard", qty: 1, price: 149.99 }],
    total: 149.99,
    status: "delivered",
    date: "2026-01-20",
  },
  {
    orderId: "ORD-2001",
    customerName: "Bob Martinez",
    email: "bob@example.com",
    items: [{ name: "Monitor Stand", qty: 1, price: 45.0 }],
    total: 45.0,
    status: "processing",
    date: "2026-03-01",
  },
];

const SHIPPING_DATA: Record<string, object> = {
  "ORD-1001": {
    carrier: "FedEx",
    trackingNumber: "FX-789456123",
    status: "in_transit",
    estimatedDelivery: "2026-03-08",
    lastUpdate: "Package departed Memphis hub",
  },
  "ORD-1002": {
    carrier: "UPS",
    trackingNumber: "1Z-999AA1-01",
    status: "delivered",
    deliveredDate: "2026-01-23",
    signedBy: "A. Chen",
  },
  "ORD-2001": {
    carrier: "USPS",
    trackingNumber: "9400111899223",
    status: "label_created",
    estimatedDelivery: "2026-03-10",
    lastUpdate: "Shipping label created, awaiting pickup",
  },
};

// ─── Tool Implementations ────────────────────────────────────────────────────

function searchOrders(args: { customer_name: string; email?: string }): string {
  const matches = MOCK_ORDERS.filter((o) => {
    const nameMatch = o.customerName.toLowerCase().includes(args.customer_name.toLowerCase());
    const emailMatch = args.email ? o.email.toLowerCase() === args.email.toLowerCase() : true;
    return nameMatch && emailMatch;
  });

  if (matches.length === 0) {
    return JSON.stringify({ found: false, message: "No orders found for that customer" });
  }

  return JSON.stringify({
    found: true,
    orders: matches.map((o) => ({
      orderId: o.orderId,
      date: o.date,
      total: o.total,
      status: o.status,
      itemCount: o.items.length,
    })),
  });
}

function getOrderDetails(args: { order_id: string }): string {
  const order = MOCK_ORDERS.find((o) => o.orderId === args.order_id);
  if (!order) {
    return JSON.stringify({ error: `Order ${args.order_id} not found` });
  }
  return JSON.stringify(order);
}

function checkShippingStatus(args: { order_id: string }): string {
  const shipping = SHIPPING_DATA[args.order_id];
  if (!shipping) {
    return JSON.stringify({ error: `No shipping info for order ${args.order_id}` });
  }
  return JSON.stringify({ orderId: args.order_id, ...shipping });
}

function processRefund(args: { order_id: string; reason: string }): string {
  const order = MOCK_ORDERS.find((o) => o.orderId === args.order_id);
  if (!order) {
    return JSON.stringify({ success: false, error: `Order ${args.order_id} not found` });
  }
  return JSON.stringify({
    success: true,
    refundId: `REF-${Date.now()}`,
    orderId: args.order_id,
    amount: order.total,
    reason: args.reason,
    status: "processing",
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_orders":
      return searchOrders(args as Parameters<typeof searchOrders>[0]);
    case "get_order_details":
      return getOrderDetails(args as Parameters<typeof getOrderDetails>[0]);
    case "check_shipping_status":
      return checkShippingStatus(args as Parameters<typeof checkShippingStatus>[0]);
    case "process_refund":
      return processRefund(args as Parameters<typeof processRefund>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
