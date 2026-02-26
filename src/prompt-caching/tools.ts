import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────
//
// 12 customer support tools with detailed "strong-style" descriptions.
// The verbose descriptions are intentional — they maximize the stable prefix
// token count so we can measure KV-cache reuse in the benchmark.
//
// Each description follows the pattern from src/tool-descriptions/:
//   1. Verb-first summary
//   2. When to use it
//   3. When NOT to use it
//   4. Parameter descriptions with format examples

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_orders",
      description:
        "Searches the order database by customer email address and optional status filter. " +
        "Returns a list of matching orders with IDs, items, amounts, and statuses. " +
        "Use this when you have a customer's email but no order ID. " +
        "Do NOT use this if you already have an order ID — use get_order_details instead, " +
        "as it is faster and returns complete information for a single order.",
      parameters: {
        type: "object",
        properties: {
          customer_email: {
            type: "string",
            description:
              "The customer's email address, e.g. sarah@example.com. " +
              "Must be a valid email — do NOT pass a name or phone number.",
          },
          status: {
            type: "string",
            description:
              "Optional filter by order status. Omit to return all orders for the customer.",
            enum: ["active", "refunded", "cancelled"],
          },
        },
        required: ["customer_email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_details",
      description:
        "Fetches full details for a specific order by its ID, including item name, amount, " +
        "purchase date, customer email, and current status. " +
        "Always call this BEFORE issue_refund, check_warranty, or escalate_to_human to confirm " +
        "the order exists and retrieve the customer email needed for send_message. " +
        "Do NOT call search_orders if you already have the order ID.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID, e.g. ORD-001. Must start with 'ORD-'.",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "issue_refund",
      description:
        "Issues a refund for an order and updates its status to 'refunded'. " +
        "Only call this AFTER get_order_details confirms the order exists and is 'active'. " +
        "Do NOT call this if the order status is already 'refunded' — it will fail. " +
        "Do NOT call this if the order is 'cancelled' — cancelled orders are not eligible. " +
        "Amount must be a number (no currency symbol), e.g. 89.99, and must not exceed " +
        "the original order amount. For refunds over $500, escalate_to_human instead.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID, e.g. ORD-001. Obtain this from get_order_details.",
          },
          amount: {
            type: "string",
            description:
              "Refund amount as a plain number without currency symbol, e.g. 89.99. " +
              "Must not exceed the original order amount.",
          },
          reason: {
            type: "string",
            description:
              "Brief reason for the refund, e.g. 'Customer request — item defective'. " +
              "Required for audit trail.",
          },
        },
        required: ["order_id", "amount", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_message",
      description:
        "Sends an email message to a customer at the specified email address. " +
        "Use this to confirm actions (refund processed, escalation raised, callback scheduled) " +
        "or to respond to informational questions. " +
        "Do NOT use this as a substitute for actually processing a refund — " +
        "always call issue_refund first, then send_message to confirm. " +
        "Obtain the customer_email from get_order_details — do NOT guess or use a name.",
      parameters: {
        type: "object",
        properties: {
          customer_email: {
            type: "string",
            description:
              "The customer's email address, e.g. sarah@example.com. " +
              "Obtain this from get_order_details — do NOT guess.",
          },
          subject: {
            type: "string",
            description:
              "Email subject line, e.g. 'Your refund for ORD-001 has been processed'. " +
              "Keep it concise and descriptive.",
          },
          body: {
            type: "string",
            description: "Full email body. Be concise, professional, and include relevant details.",
          },
        },
        required: ["customer_email", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "Escalates a support case to a human agent with the specified priority. " +
        "Only use this when: (1) the customer explicitly requests a human agent, " +
        "(2) the issue cannot be resolved with available tools (e.g. fraud, complex dispute), " +
        "or (3) the refund amount exceeds $500. " +
        "Do NOT use this for routine refund requests, status checks, or simple questions — " +
        "handle those directly with issue_refund, send_message, or search_knowledge_base.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID, e.g. ORD-001. Obtain from get_order_details.",
          },
          priority: {
            type: "string",
            description:
              "Escalation priority. Use 'low' for general questions, " +
              "'medium' for standard disputes, 'high' for fraud, safety, or urgent issues.",
            enum: ["low", "medium", "high"],
          },
          notes: {
            type: "string",
            description:
              "Context for the human agent: what the customer requested, " +
              "what tools were already called, and why escalation is needed.",
          },
        },
        required: ["order_id", "priority", "notes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_warranty",
      description:
        "Checks the warranty status for a product associated with an order. " +
        "Returns warranty type (standard or extended), expiration date, and whether the " +
        "warranty is still active. Call get_order_details first to confirm the order exists. " +
        "Use this before processing a warranty claim or recommending next steps for defective products.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description:
              "The order ID to check warranty for, e.g. ORD-001. " +
              "Must be a valid order ID obtained from get_order_details.",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_return_policy",
      description:
        "Looks up the return policy for a specific product category. " +
        "Returns the return window (days), conditions for return, restocking fee percentage, " +
        "and whether prepaid return labels are provided. " +
        "Use this to answer customer questions about return eligibility before processing a refund. " +
        "Do NOT guess return policies — always look them up with this tool.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              "Product category, e.g. 'electronics', 'accessories', 'furniture'. " +
              "Infer from the product name in the order details.",
            enum: ["electronics", "accessories", "furniture", "clothing", "software"],
          },
        },
        required: ["category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description:
        "Searches the internal help articles and FAQ database for answers to common questions. " +
        "Returns relevant article titles and summaries. " +
        "Use this for policy questions, troubleshooting steps, and general product information " +
        "before attempting to answer from your own knowledge. " +
        "Do NOT use this for order-specific queries — use get_order_details or search_orders instead.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search query describing the customer's question, e.g. 'how to return a monitor'. " +
              "Use natural language, not keywords.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_order_status",
      description:
        "Changes the status of an order. Valid transitions: 'active' to 'processing', " +
        "'processing' to 'shipped', 'shipped' to 'delivered'. " +
        "Do NOT use this to cancel or refund — use issue_refund for refunds. " +
        "Call get_order_details first to verify the current status and ensure the transition is valid.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID, e.g. ORD-001.",
          },
          new_status: {
            type: "string",
            description:
              "The new status to set. Must be a valid transition from the current status.",
            enum: ["processing", "shipped", "delivered"],
          },
        },
        required: ["order_id", "new_status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_history",
      description:
        "Retrieves the full interaction history for a customer, including past support tickets, " +
        "previous refunds, and communication log. " +
        "Use this to understand the customer's history before making decisions — repeat refund " +
        "requesters or VIP customers may need different handling. " +
        "Requires the customer's email address, obtained from get_order_details.",
      parameters: {
        type: "object",
        properties: {
          customer_email: {
            type: "string",
            description:
              "The customer's email address, e.g. sarah@example.com. " +
              "Obtain from get_order_details.",
          },
        },
        required: ["customer_email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_callback",
      description:
        "Schedules a phone callback for a customer at their preferred time. " +
        "Use this when a customer requests a callback or when an issue requires phone discussion. " +
        "Do NOT schedule callbacks for simple questions that can be resolved via email — " +
        "use send_message instead. Available time slots are in 30-minute increments between " +
        "9:00 AM and 5:00 PM in the customer's timezone.",
      parameters: {
        type: "object",
        properties: {
          customer_email: {
            type: "string",
            description: "The customer's email address for callback confirmation.",
          },
          preferred_time: {
            type: "string",
            description:
              "Preferred callback time in ISO 8601 format, e.g. '2026-02-27T14:00:00Z'. " +
              "Must be during business hours (9 AM - 5 PM).",
          },
          topic: {
            type: "string",
            description: "Brief description of the callback topic for the support agent.",
          },
        },
        required: ["customer_email", "preferred_time", "topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_discount",
      description:
        "Applies a promotional discount code to an active order. " +
        "Validates the code and adjusts the order total. " +
        "Only works on 'active' orders — cannot apply discounts to refunded, cancelled, " +
        "or already-shipped orders. " +
        "Each order can only have one discount code applied. If a code was already applied, " +
        "this will fail. Verify the order status with get_order_details first.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID, e.g. ORD-001.",
          },
          discount_code: {
            type: "string",
            description:
              "The promotional discount code, e.g. 'SAVE20'. " +
              "Case-insensitive. Must be a valid, non-expired code.",
          },
        },
        required: ["order_id", "discount_code"],
      },
    },
  },
];

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface Order {
  orderId: string;
  customerName: string;
  customerEmail: string;
  item: string;
  amount: number;
  purchaseDate: string;
  status: string;
}

const MOCK_ORDERS: Record<string, Order> = {
  "ORD-001": {
    orderId: "ORD-001",
    customerName: "Sarah Chen",
    customerEmail: "sarah@example.com",
    item: "Laptop Stand",
    amount: 89,
    purchaseDate: "2026-02-10",
    status: "active",
  },
  "ORD-002": {
    orderId: "ORD-002",
    customerName: "James Liu",
    customerEmail: "james@example.com",
    item: "Mechanical Keyboard",
    amount: 220,
    purchaseDate: "2026-01-10",
    status: "refunded",
  },
  "ORD-003": {
    orderId: "ORD-003",
    customerName: "Maria Santos",
    customerEmail: "maria@example.com",
    item: "USB-C Hub",
    amount: 45,
    purchaseDate: "2026-02-20",
    status: "active",
  },
  "ORD-004": {
    orderId: "ORD-004",
    customerName: "David Park",
    customerEmail: "david@example.com",
    item: "Monitor Arm",
    amount: 580,
    purchaseDate: "2026-02-15",
    status: "active",
  },
  "ORD-005": {
    orderId: "ORD-005",
    customerName: "Emily Wong",
    customerEmail: "emily@example.com",
    item: "Webcam Pro",
    amount: 159,
    purchaseDate: "2026-02-18",
    status: "active",
  },
};

const RETURN_POLICIES: Record<string, object> = {
  electronics: {
    category: "electronics",
    returnWindowDays: 30,
    conditions: "Item must be in original packaging, no physical damage",
    restockingFeePercent: 15,
    prepaidLabel: true,
  },
  accessories: {
    category: "accessories",
    returnWindowDays: 60,
    conditions: "Item must be unused and in original packaging",
    restockingFeePercent: 0,
    prepaidLabel: true,
  },
  furniture: {
    category: "furniture",
    returnWindowDays: 14,
    conditions: "Must be unassembled, in original packaging",
    restockingFeePercent: 25,
    prepaidLabel: false,
  },
  clothing: {
    category: "clothing",
    returnWindowDays: 45,
    conditions: "Unworn, tags attached",
    restockingFeePercent: 0,
    prepaidLabel: true,
  },
  software: {
    category: "software",
    returnWindowDays: 7,
    conditions: "License key must not have been activated",
    restockingFeePercent: 0,
    prepaidLabel: false,
  },
};

const KNOWLEDGE_BASE = [
  {
    title: "How to Return a Product",
    summary:
      "Initiate a return within the return window for your product category. " +
      "Log into your account, find the order, and click 'Start Return'. " +
      "Prepaid labels are provided for electronics and accessories.",
  },
  {
    title: "Refund Processing Times",
    summary:
      "Refunds are processed within 3-5 business days after we receive the returned item. " +
      "Credit card refunds may take an additional 2-3 days to appear on your statement.",
  },
  {
    title: "Warranty Claims",
    summary:
      "Standard warranty covers manufacturing defects for 1 year from purchase. " +
      "Extended warranty (if purchased) covers accidental damage for 2 years. " +
      "Contact support with your order ID to start a claim.",
  },
  {
    title: "Shipping and Delivery",
    summary:
      "Standard shipping takes 5-7 business days. Express shipping takes 2-3 business days. " +
      "Free shipping on orders over $50. Tracking numbers are emailed within 24 hours of shipment.",
  },
];

// ─── Tool Implementations ─────────────────────────────────────────────────────

function searchOrders(args: Record<string, string>): string {
  const email = args.customer_email ?? "";
  if (!email.includes("@")) {
    return JSON.stringify({
      error: `customer_email must be a valid email. Received: '${email}'.`,
    });
  }
  const matches = Object.values(MOCK_ORDERS).filter(
    (o) => o.customerEmail.toLowerCase() === email.toLowerCase(),
  );
  if (matches.length === 0) {
    return JSON.stringify({ error: `No orders found for email: ${email}` });
  }
  return JSON.stringify({ orders: matches });
}

function getOrderDetails(args: Record<string, string>): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({ error: `Order '${args.order_id}' not found.` });
  }
  return JSON.stringify(order);
}

function issueRefund(args: Record<string, string>): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({ error: `Order '${args.order_id}' not found.` });
  }
  if (order.status === "refunded") {
    return JSON.stringify({ error: `Order ${args.order_id} has already been refunded.` });
  }
  const amount = parseFloat(args.amount);
  if (isNaN(amount) || amount > order.amount) {
    return JSON.stringify({ error: `Invalid refund amount: ${args.amount}` });
  }
  order.status = "refunded";
  return JSON.stringify({
    success: true,
    refundId: `REF-${Date.now()}`,
    orderId: args.order_id,
    amount,
  });
}

function sendMessage(args: Record<string, string>): string {
  const email = args.customer_email ?? "";
  if (!email.includes("@")) {
    return JSON.stringify({ error: `Invalid email: '${email}'.` });
  }
  return JSON.stringify({ success: true, to: email, subject: args.subject });
}

function escalateToHuman(args: Record<string, string>): string {
  return JSON.stringify({
    success: true,
    ticketId: `TKT-${Date.now()}`,
    orderId: args.order_id,
    priority: args.priority,
  });
}

function checkWarranty(args: Record<string, string>): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({ error: `Order '${args.order_id}' not found.` });
  }
  const purchaseDate = new Date(order.purchaseDate);
  const warrantyEnd = new Date(purchaseDate);
  warrantyEnd.setFullYear(warrantyEnd.getFullYear() + 1);
  const isActive = new Date() < warrantyEnd;
  return JSON.stringify({
    orderId: args.order_id,
    item: order.item,
    warrantyType: "standard",
    expiresOn: warrantyEnd.toISOString().split("T")[0],
    isActive,
  });
}

function getReturnPolicy(args: Record<string, string>): string {
  const policy = RETURN_POLICIES[args.category];
  if (!policy) {
    return JSON.stringify({ error: `Unknown category: '${args.category}'.` });
  }
  return JSON.stringify(policy);
}

function searchKnowledgeBase(args: Record<string, string>): string {
  const query = (args.query ?? "").toLowerCase();
  const matches = KNOWLEDGE_BASE.filter(
    (article) =>
      article.title.toLowerCase().includes(query) || article.summary.toLowerCase().includes(query),
  );
  if (matches.length === 0) {
    return JSON.stringify({ articles: KNOWLEDGE_BASE.slice(0, 2) });
  }
  return JSON.stringify({ articles: matches });
}

function updateOrderStatus(args: Record<string, string>): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({ error: `Order '${args.order_id}' not found.` });
  }
  const prev = order.status;
  order.status = args.new_status;
  return JSON.stringify({
    success: true,
    orderId: args.order_id,
    previousStatus: prev,
    newStatus: args.new_status,
  });
}

function getCustomerHistory(args: Record<string, string>): string {
  const email = args.customer_email ?? "";
  const orders = Object.values(MOCK_ORDERS).filter(
    (o) => o.customerEmail.toLowerCase() === email.toLowerCase(),
  );
  return JSON.stringify({
    customer: email,
    totalOrders: orders.length,
    orders: orders.map((o) => ({ orderId: o.orderId, item: o.item, status: o.status })),
    previousTickets: 0,
    accountSince: "2025-06-15",
  });
}

function scheduleCallback(args: Record<string, string>): string {
  return JSON.stringify({
    success: true,
    callbackId: `CB-${Date.now()}`,
    scheduledFor: args.preferred_time,
    topic: args.topic,
    confirmationSentTo: args.customer_email,
  });
}

function applyDiscount(args: Record<string, string>): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({ error: `Order '${args.order_id}' not found.` });
  }
  if (order.status !== "active") {
    return JSON.stringify({ error: `Cannot apply discount to ${order.status} order.` });
  }
  const code = (args.discount_code ?? "").toUpperCase();
  const discounts: Record<string, number> = { SAVE20: 0.2, WELCOME10: 0.1, VIP30: 0.3 };
  const pct = discounts[code];
  if (pct === undefined) {
    return JSON.stringify({ error: `Invalid or expired discount code: '${code}'.` });
  }
  const discount = Math.round(order.amount * pct * 100) / 100;
  return JSON.stringify({
    success: true,
    orderId: args.order_id,
    code,
    discountPercent: pct * 100,
    discountAmount: discount,
    newTotal: order.amount - discount,
  });
}

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_orders":
      return searchOrders(args);
    case "get_order_details":
      return getOrderDetails(args);
    case "issue_refund":
      return issueRefund(args);
    case "send_message":
      return sendMessage(args);
    case "escalate_to_human":
      return escalateToHuman(args);
    case "check_warranty":
      return checkWarranty(args);
    case "get_return_policy":
      return getReturnPolicy(args);
    case "search_knowledge_base":
      return searchKnowledgeBase(args);
    case "update_order_status":
      return updateOrderStatus(args);
    case "get_customer_history":
      return getCustomerHistory(args);
    case "schedule_callback":
      return scheduleCallback(args);
    case "apply_discount":
      return applyDiscount(args);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
