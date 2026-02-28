import type { ToolDefinition } from "../shared/types.js";
import { buildGetSkillTool } from "./skills.js";

// ─── Mock Data ───────────────────────────────────────────────────────────────
//
// 8 orders across multiple customers. Key scenarios for testing:
//   - ORD-1001: shipped, customer reported item arrived damaged
//   - ORD-1003: shipped to wrong address
//   - ORD-1005: stuck in processing (potential backorder)
//   - Others: normal states for background data

export type AgentMode = "skills" | "no-skills";

interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  orderId: string;
  customerName: string;
  customerEmail: string;
  status: "processing" | "shipped" | "delivered" | "cancelled" | "returned";
  items: OrderItem[];
  total: number;
  shippingAddress: string;
  trackingNumber: string | null;
  notes: string;
  createdAt: string;
}

interface InventoryItem {
  sku: string;
  name: string;
  inStock: number;
  warehouse: string;
}

const ORDERS: Order[] = [
  {
    orderId: "ORD-1001",
    customerName: "Alice Johnson",
    customerEmail: "alice@example.com",
    status: "shipped",
    items: [
      { sku: "LAPTOP-15", name: 'ProBook Laptop 15"', quantity: 1, price: 1299.99 },
      { sku: "CASE-15", name: "Laptop Carrying Case", quantity: 1, price: 49.99 },
    ],
    total: 1349.98,
    shippingAddress: "123 Main St, Springfield, IL 62701",
    trackingNumber: "TRK-88431",
    notes: "Customer reported laptop arrived with cracked screen",
    createdAt: "2026-02-20",
  },
  {
    orderId: "ORD-1002",
    customerName: "Bob Smith",
    customerEmail: "bob@example.com",
    status: "delivered",
    items: [
      { sku: "HEADPHONES-BT", name: "Wireless Headphones BT-500", quantity: 2, price: 89.99 },
    ],
    total: 179.98,
    shippingAddress: "456 Oak Ave, Portland, OR 97201",
    trackingNumber: "TRK-77215",
    notes: "",
    createdAt: "2026-02-15",
  },
  {
    orderId: "ORD-1003",
    customerName: "Carol Davis",
    customerEmail: "carol@example.com",
    status: "shipped",
    items: [{ sku: "MONITOR-27", name: '27" 4K Monitor', quantity: 1, price: 449.99 }],
    total: 449.99,
    shippingAddress: "789 Wrong Blvd, Austin, TX 73301",
    trackingNumber: "TRK-99102",
    notes: "ALERT: Shipped to old address — customer moved to 321 New St, Austin, TX 73301",
    createdAt: "2026-02-22",
  },
  {
    orderId: "ORD-1004",
    customerName: "Dave Wilson",
    customerEmail: "dave@example.com",
    status: "delivered",
    items: [
      { sku: "KEYBOARD-MK", name: "Mechanical Keyboard MK-70", quantity: 1, price: 149.99 },
      { sku: "MOUSE-ERG", name: "Ergonomic Mouse", quantity: 1, price: 59.99 },
    ],
    total: 209.98,
    shippingAddress: "567 Pine Rd, Denver, CO 80201",
    trackingNumber: "TRK-55890",
    notes: "",
    createdAt: "2026-02-10",
  },
  {
    orderId: "ORD-1005",
    customerName: "Eve Martinez",
    customerEmail: "eve@example.com",
    status: "processing",
    items: [{ sku: "TABLET-10", name: '10" Tablet Pro', quantity: 1, price: 599.99 }],
    total: 599.99,
    shippingAddress: "890 Elm St, Seattle, WA 98101",
    trackingNumber: null,
    notes: "Stuck in processing — item was out of stock at time of order",
    createdAt: "2026-02-18",
  },
  {
    orderId: "ORD-1006",
    customerName: "Frank Lee",
    customerEmail: "frank@example.com",
    status: "cancelled",
    items: [{ sku: "LAPTOP-15", name: 'ProBook Laptop 15"', quantity: 1, price: 1299.99 }],
    total: 1299.99,
    shippingAddress: "234 Maple Dr, Chicago, IL 60601",
    trackingNumber: null,
    notes: "Cancelled by customer before shipping",
    createdAt: "2026-02-12",
  },
  {
    orderId: "ORD-1007",
    customerName: "Grace Kim",
    customerEmail: "grace@example.com",
    status: "shipped",
    items: [
      { sku: "HEADPHONES-BT", name: "Wireless Headphones BT-500", quantity: 1, price: 89.99 },
      { sku: "CHARGER-USB", name: "USB-C Fast Charger", quantity: 2, price: 29.99 },
    ],
    total: 149.97,
    shippingAddress: "678 Cedar Ln, Miami, FL 33101",
    trackingNumber: "TRK-44567",
    notes: "",
    createdAt: "2026-02-24",
  },
  {
    orderId: "ORD-1008",
    customerName: "Alice Johnson",
    customerEmail: "alice@example.com",
    status: "processing",
    items: [{ sku: "MOUSE-ERG", name: "Ergonomic Mouse", quantity: 1, price: 59.99 }],
    total: 59.99,
    shippingAddress: "123 Main St, Springfield, IL 62701",
    trackingNumber: null,
    notes: "",
    createdAt: "2026-02-26",
  },
];

const INVENTORY: InventoryItem[] = [
  { sku: "LAPTOP-15", name: 'ProBook Laptop 15"', inStock: 3, warehouse: "West" },
  { sku: "CASE-15", name: "Laptop Carrying Case", inStock: 12, warehouse: "West" },
  { sku: "HEADPHONES-BT", name: "Wireless Headphones BT-500", inStock: 25, warehouse: "East" },
  { sku: "MONITOR-27", name: '27" 4K Monitor', inStock: 7, warehouse: "West" },
  { sku: "KEYBOARD-MK", name: "Mechanical Keyboard MK-70", inStock: 0, warehouse: "East" },
  { sku: "MOUSE-ERG", name: "Ergonomic Mouse", inStock: 18, warehouse: "East" },
  { sku: "TABLET-10", name: '10" Tablet Pro', inStock: 4, warehouse: "West" },
  { sku: "CHARGER-USB", name: "USB-C Fast Charger", inStock: 50, warehouse: "East" },
];

// ─── Tool Definitions ────────────────────────────────────────────────────────
//
// Two variants: concise (for skills mode) and verbose (anti-pattern, no-skills mode).
// The verbose versions embed full workflow instructions in each tool description,
// which is what skill injection is designed to avoid.

export const orderTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_orders",
      description:
        "Search orders by customer name, order ID, or status. Returns matching orders with basic info.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Customer name, order ID, or status to search for",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_details",
      description: "Get full details for a specific order including items, shipping, and notes.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID (e.g., ORD-1001)",
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
      description: "Issue a refund for an order. Returns the refund confirmation.",
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
  {
    type: "function",
    function: {
      name: "update_shipping",
      description: "Update shipping status or address for an order.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to update",
          },
          status: {
            type: "string",
            description: "New shipping status",
            enum: ["processing", "shipped", "delivered"],
          },
          tracking_number: {
            type: "string",
            description: "New tracking number (required when status is 'shipped')",
          },
        },
        required: ["order_id", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_customer_email",
      description: "Send an email notification to the customer associated with an order.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID (used to look up customer email)",
          },
          subject: {
            type: "string",
            description: "Email subject line",
          },
          body: {
            type: "string",
            description: "Email body text",
          },
        },
        required: ["order_id", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_inventory",
      description: "Check current inventory level for a product SKU.",
      parameters: {
        type: "object",
        properties: {
          sku: {
            type: "string",
            description: "The product SKU to check (e.g., LAPTOP-15)",
          },
        },
        required: ["sku"],
      },
    },
  },
];

/** Verbose tool descriptions — the anti-pattern where workflow instructions are embedded in every tool */
export const orderToolsVerbose: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_orders",
      description: `Search orders by customer name, order ID, or status. Returns matching orders with basic info.

WORKFLOW INSTRUCTIONS:
- When investigating a complaint: always search for the order first, then call get_order_details for the full record, then check_inventory for replacement availability.
- When fulfilling backorders: search with status "processing" to find pending orders, then check inventory for each, then update_shipping for fulfillable ones.
- When handling escalations: search first, then investigate, then decide between replacement (update_shipping) or refund (process_refund), and always send_customer_email at the end.
- For return processing: after finding the order, verify it's in "shipped" or "delivered" status before processing a refund.`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Customer name, order ID, or status to search for",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_details",
      description: `Get full details for a specific order including items, shipping, and notes.

WORKFLOW INSTRUCTIONS:
- For complaints: after getting details, check the notes field for existing issues. Then check_inventory for each item SKU to see if replacements are available.
- For returns: verify the status is "shipped" or "delivered" — orders in "processing" or "cancelled" cannot be returned. Then call process_refund.
- For escalations: get details first, then decide on resolution path. If the item is damaged, check inventory for replacement. If the address is wrong, use update_shipping to correct it.
- Always read the notes field — it contains important context about known issues with the order.`,
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID (e.g., ORD-1001)",
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
      description: `Issue a refund for an order. Returns the refund confirmation.

WORKFLOW INSTRUCTIONS:
- Before calling this: always verify the order with get_order_details first. Only refund orders in "shipped" or "delivered" status.
- For damaged items: include "damaged item" in the reason. After refunding, check_inventory to see if a replacement can be sent.
- For wrong address shipments: try update_shipping to redirect before resorting to a refund.
- After processing: always send_customer_email to confirm the refund with the amount and expected timeline.
- For full escalations: this is usually the last resort after investigating and failing to resolve with a replacement.`,
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
  {
    type: "function",
    function: {
      name: "update_shipping",
      description: `Update shipping status or address for an order.

WORKFLOW INSTRUCTIONS:
- For backorder fulfillment: set status to "shipped" and provide a tracking number. Always follow up with send_customer_email to notify the customer.
- For wrong address orders: update the shipping address and tracking. Check if the package can be intercepted.
- For replacement shipments (after damage/complaint): use this to ship the replacement item. Generate a new tracking number.
- Always verify inventory with check_inventory before shipping — don't ship what isn't in stock.
- After updating: always send_customer_email with the new tracking info.`,
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to update",
          },
          status: {
            type: "string",
            description: "New shipping status",
            enum: ["processing", "shipped", "delivered"],
          },
          tracking_number: {
            type: "string",
            description: "New tracking number (required when status is 'shipped')",
          },
        },
        required: ["order_id", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_customer_email",
      description: `Send an email notification to the customer associated with an order.

WORKFLOW INSTRUCTIONS:
- For complaint investigations: send a summary of findings and next steps.
- For refunds: include the refund amount, reason, and expected processing time (3-5 business days).
- For shipping updates: include the new tracking number and estimated delivery date.
- For escalations: send a comprehensive summary covering what was investigated, what action was taken, and what the customer should expect next.
- For backorder fulfillment: notify that their order is now being shipped with tracking info.
- Always use a professional, empathetic tone. Address the customer by name.`,
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID (used to look up customer email)",
          },
          subject: {
            type: "string",
            description: "Email subject line",
          },
          body: {
            type: "string",
            description: "Email body text",
          },
        },
        required: ["order_id", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_inventory",
      description: `Check current inventory level for a product SKU.

WORKFLOW INSTRUCTIONS:
- For complaints: check if the damaged/wrong item can be replaced. If inStock > 0, suggest replacement via update_shipping.
- For returns: check if the returned item should be restocked.
- For backorders: check if items that were previously out of stock are now available. If so, proceed with update_shipping.
- Common SKUs: LAPTOP-15, CASE-15, HEADPHONES-BT, MONITOR-27, KEYBOARD-MK, MOUSE-ERG, TABLET-10, CHARGER-USB.
- If inStock is 0, inform the customer that a replacement isn't currently available and offer a refund instead.`,
      parameters: {
        type: "object",
        properties: {
          sku: {
            type: "string",
            description: "The product SKU to check (e.g., LAPTOP-15)",
          },
        },
        required: ["sku"],
      },
    },
  },
];

// ─── Tool Implementations ────────────────────────────────────────────────────

function searchOrders(args: { query: string }): string {
  const q = args.query.toLowerCase();
  const matches = ORDERS.filter(
    (o) =>
      o.orderId.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.status.toLowerCase() === q,
  );

  if (matches.length === 0) {
    return JSON.stringify({ results: [], message: `No orders found matching "${args.query}"` });
  }

  return JSON.stringify({
    results: matches.map((o) => ({
      orderId: o.orderId,
      customerName: o.customerName,
      status: o.status,
      total: o.total,
      createdAt: o.createdAt,
    })),
    total: matches.length,
  });
}

function getOrderDetails(args: { order_id: string }): string {
  const order = ORDERS.find((o) => o.orderId === args.order_id);
  if (!order) {
    return JSON.stringify({ error: `Order not found: ${args.order_id}` });
  }
  return JSON.stringify(order);
}

function processRefund(args: { order_id: string; reason: string }): string {
  const order = ORDERS.find((o) => o.orderId === args.order_id);
  if (!order) {
    return JSON.stringify({ error: `Order not found: ${args.order_id}` });
  }
  if (order.status !== "shipped" && order.status !== "delivered") {
    return JSON.stringify({
      error: `Cannot refund order ${args.order_id} — status is "${order.status}". Only shipped or delivered orders can be refunded.`,
    });
  }

  order.status = "returned";
  return JSON.stringify({
    success: true,
    refundId: `REF-${Date.now()}`,
    orderId: args.order_id,
    amount: order.total,
    reason: args.reason,
    status: "refund_processing",
    estimatedDays: 5,
  });
}

function updateShipping(args: {
  order_id: string;
  status: string;
  tracking_number?: string;
}): string {
  const order = ORDERS.find((o) => o.orderId === args.order_id);
  if (!order) {
    return JSON.stringify({ error: `Order not found: ${args.order_id}` });
  }

  const newStatus = args.status as Order["status"];
  order.status = newStatus;
  if (args.tracking_number) {
    order.trackingNumber = args.tracking_number;
  }

  return JSON.stringify({
    success: true,
    orderId: args.order_id,
    newStatus: order.status,
    trackingNumber: order.trackingNumber,
  });
}

function sendCustomerEmail(args: { order_id: string; subject: string; body: string }): string {
  const order = ORDERS.find((o) => o.orderId === args.order_id);
  if (!order) {
    return JSON.stringify({ error: `Order not found: ${args.order_id}` });
  }

  return JSON.stringify({
    success: true,
    emailId: `EMAIL-${Date.now()}`,
    to: order.customerEmail,
    customerName: order.customerName,
    subject: args.subject,
    preview: args.body.slice(0, 100),
  });
}

function checkInventory(args: { sku: string }): string {
  const item = INVENTORY.find((i) => i.sku === args.sku);
  if (!item) {
    return JSON.stringify({ error: `Unknown SKU: ${args.sku}` });
  }

  return JSON.stringify({
    sku: item.sku,
    name: item.name,
    inStock: item.inStock,
    warehouse: item.warehouse,
    available: item.inStock > 0,
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_orders":
      return searchOrders(args as Parameters<typeof searchOrders>[0]);
    case "get_order_details":
      return getOrderDetails(args as Parameters<typeof getOrderDetails>[0]);
    case "process_refund":
      return processRefund(args as Parameters<typeof processRefund>[0]);
    case "update_shipping":
      return updateShipping(args as Parameters<typeof updateShipping>[0]);
    case "send_customer_email":
      return sendCustomerEmail(args as Parameters<typeof sendCustomerEmail>[0]);
    case "check_inventory":
      return checkInventory(args as Parameters<typeof checkInventory>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Build Tools For Mode ────────────────────────────────────────────────────
//
// Skills mode: concise tool descriptions + get_skill meta-tool
// No-skills mode: verbose tool descriptions with workflow instructions embedded

export function buildTools(mode: AgentMode): ToolDefinition[] {
  if (mode === "skills") {
    const toolNames = orderTools.map((t) => t.function.name);
    return [...orderTools, buildGetSkillTool(toolNames)];
  }
  return orderToolsVerbose;
}

/** Get the names of all domain tools (excluding get_skill) */
export function getDomainToolNames(): string[] {
  return orderTools.map((t) => t.function.name);
}
