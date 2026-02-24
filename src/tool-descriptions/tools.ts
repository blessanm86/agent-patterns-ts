import type { ToolDefinition, Order, SupportTicket } from "./types.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────
//
// The same 5 tools are defined twice — weakTools and strongTools.
// The implementations are IDENTICAL. Only the descriptions change.
//
// This is the whole point: description quality alone determines whether
// the model calls the right tool, with the right arguments, in the right order.

// ─── Weak Tool Definitions ────────────────────────────────────────────────────
//
// Minimal one-line descriptions. Ambiguous parameter names. No format hints.
// No "when not to use" guidance. No edge case coverage.
// This is what most tools look like when written quickly.

export const weakTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_orders",
      description: "Search for orders.",
      parameters: {
        type: "object",
        properties: {
          customer: {
            type: "string",
            description: "The customer to search for",
          },
          status: {
            type: "string",
            description: "Order status",
            enum: ["active", "refunded", "cancelled"],
          },
        },
        required: ["customer"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_details",
      description: "Get order details.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID",
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
      description: "Issue a refund.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID",
          },
          amount: {
            type: "string",
            description: "The refund amount",
          },
          reason: {
            type: "string",
            description: "The reason for the refund",
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
      description: "Send a message to the customer.",
      parameters: {
        type: "object",
        properties: {
          customer: {
            type: "string",
            description: "The customer to message",
          },
          subject: {
            type: "string",
            description: "Message subject",
          },
          body: {
            type: "string",
            description: "Message body",
          },
        },
        required: ["customer", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description: "Escalate to a human agent.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID",
          },
          priority: {
            type: "string",
            description: "Priority level",
            enum: ["low", "medium", "high"],
          },
          notes: {
            type: "string",
            description: "Notes for the human agent",
          },
        },
        required: ["order_id", "priority", "notes"],
      },
    },
  },
];

// ─── Strong Tool Definitions ──────────────────────────────────────────────────
//
// Every description follows the same structure:
//   1. Verb-first summary of what the tool does
//   2. When to use it (the precondition)
//   3. When NOT to use it (the guard)
//   4. Parameter descriptions include type + inline format example
//
// Parameter names encode their type and role (customer_email not customer).
// Error messages from implementations are actionable, not opaque.

export const strongTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_orders",
      description:
        "Searches orders by customer email address and optional status filter. " +
        "Use this when you have a customer's email but no order ID. " +
        "Do NOT use this if you already have an order ID — use get_order_details instead, " +
        "as it is faster and more precise.",
      parameters: {
        type: "object",
        properties: {
          customer_email: {
            type: "string",
            description:
              "The customer's email address, e.g. jane@example.com. " +
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
        "Fetches full details for a specific order by its ID (item, amount, purchase date, " +
        "customer email, status). " +
        "Always call this BEFORE issue_refund or escalate_to_human to confirm the order exists " +
        "and retrieve the customer email needed for send_message.",
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
        "Only call this AFTER get_order_details confirms the order exists. " +
        "Do NOT call this if the order status is already 'refunded' — it will fail. " +
        "Do NOT call this if the order is 'cancelled' — cancelled orders are not eligible. " +
        "Amount must be a number (no currency symbol), e.g. 89.99, and must not exceed " +
        "the original order amount.",
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
            description: "Brief reason for the refund, e.g. 'Customer request — item defective'.",
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
        "Sends an email message to a customer. " +
        "Use this to confirm actions (refund processed, escalation raised) or " +
        "to respond to informational questions. " +
        "Do NOT use this as a substitute for actually processing a refund — " +
        "always call issue_refund first, then send_message to confirm.",
      parameters: {
        type: "object",
        properties: {
          customer_email: {
            type: "string",
            description:
              "The customer's email address, e.g. jane@example.com. " +
              "Obtain this from get_order_details — do NOT guess or use a name.",
          },
          subject: {
            type: "string",
            description: "Email subject line, e.g. 'Your refund for ORD-001 has been processed'.",
          },
          body: {
            type: "string",
            description: "Full email body. Be concise and professional.",
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
        "Escalates a support case to a human agent. " +
        "Only use this when: (1) the customer explicitly requests a human agent, " +
        "(2) the issue cannot be resolved with available tools (e.g. fraud, complex dispute), " +
        "or (3) the refund amount exceeds $500. " +
        "Do NOT use this for routine refund requests, status checks, or simple questions — " +
        "handle those directly with issue_refund or send_message.",
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
              "'medium' for standard disputes, 'high' for fraud or urgent issues.",
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
];

// ─── Mock Data ────────────────────────────────────────────────────────────────
//
// ORD-001: active,   $89,   sarah@example.com  → normal refund (happy path)
// ORD-002: refunded, $220,  james@example.com  → already refunded (edge case)
// ORD-003: active,   $45,   maria@example.com  → simple status check
// ORD-004: active,   $580,  david@example.com  → high value (escalation candidate)

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
};

const MOCK_TICKETS: SupportTicket[] = [];

// ─── Tool Implementations ─────────────────────────────────────────────────────
//
// These are SHARED between weakTools and strongTools — the implementations
// are identical. Only the descriptions that get sent to the model differ.

function searchOrders(args: Record<string, string>): string {
  // Works for both 'customer' (weak) and 'customer_email' (strong)
  const emailArg = args.customer_email ?? args.customer ?? "";

  // Weak descriptions send names like "John Smith" — detect and return an actionable error
  const isEmail = emailArg.includes("@");
  if (!isEmail) {
    return JSON.stringify({
      error:
        `customer_email must be a valid email address, e.g. jane@example.com. ` +
        `Received: '${emailArg}'. Ask the customer for their email address.`,
    });
  }

  const matches = Object.values(MOCK_ORDERS).filter((o) => {
    const emailMatch = o.customerEmail.toLowerCase() === emailArg.toLowerCase();
    const statusMatch = !args.status || o.status === args.status;
    return emailMatch && statusMatch;
  });

  if (matches.length === 0) {
    return JSON.stringify({ error: `No orders found for email: ${emailArg}` });
  }

  return JSON.stringify({ orders: matches });
}

function getOrderDetails(args: Record<string, string>): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({
      error:
        `Order '${args.order_id}' not found. ` +
        `Order IDs follow the format ORD-001. ` +
        `Use search_orders if you need to find the order ID from a customer email.`,
    });
  }
  return JSON.stringify(order);
}

function issueRefund(args: Record<string, string>): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({ error: `Order '${args.order_id}' not found.` });
  }

  if (order.status === "refunded") {
    return JSON.stringify({
      error:
        `Order ${args.order_id} has already been refunded. ` +
        `Do not call issue_refund again — send_message the customer to confirm ` +
        `that their refund was previously processed.`,
    });
  }

  if (order.status === "cancelled") {
    return JSON.stringify({
      error: `Order ${args.order_id} is cancelled and is not eligible for a refund.`,
    });
  }

  const amount = parseFloat(args.amount);
  if (isNaN(amount)) {
    return JSON.stringify({
      error:
        `Amount must be a plain number without currency symbol, e.g. 89.99. ` +
        `Received: '${args.amount}'.`,
    });
  }

  if (amount > order.amount) {
    return JSON.stringify({
      error:
        `Refund amount $${amount} exceeds the original order amount $${order.amount}. ` +
        `Maximum refund is $${order.amount}.`,
    });
  }

  order.status = "refunded";
  return JSON.stringify({
    success: true,
    refundId: `REF-${Date.now()}`,
    orderId: args.order_id,
    amount,
    message: `Refund of $${amount} issued for order ${args.order_id}.`,
  });
}

function sendMessage(args: Record<string, string>): string {
  // Works for both 'customer' (weak) and 'customer_email' (strong)
  const emailArg = args.customer_email ?? args.customer ?? "";

  const isEmail = emailArg.includes("@");
  if (!isEmail) {
    return JSON.stringify({
      error:
        `customer_email must be a valid email address, e.g. jane@example.com. ` +
        `Received: '${emailArg}'. Obtain the email from get_order_details first.`,
    });
  }

  return JSON.stringify({
    success: true,
    to: emailArg,
    subject: args.subject,
    message: `Email sent to ${emailArg}.`,
  });
}

function escalateToHuman(args: Record<string, string>): string {
  const order = MOCK_ORDERS[args.order_id];
  if (!order) {
    return JSON.stringify({ error: `Order '${args.order_id}' not found.` });
  }

  const ticket: SupportTicket = {
    ticketId: `TKT-${Date.now()}`,
    orderId: args.order_id,
    status: "escalated",
    priority: (args.priority as SupportTicket["priority"]) ?? "medium",
    notes: args.notes,
  };

  MOCK_TICKETS.push(ticket);

  return JSON.stringify({
    success: true,
    ticketId: ticket.ticketId,
    message: `Case escalated to human agent with priority '${ticket.priority}'.`,
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
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
