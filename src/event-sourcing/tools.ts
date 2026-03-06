// ─── Tool Definitions + Implementations ──────────────────────────────────────
//
// Key difference from a normal agent: these tools do NOT mutate state directly.
// Each tool creates an "intention" and passes it to the orchestrator.
// The orchestrator validates against business rules, then either:
//   - Accepts → appends event to the store → returns success
//   - Rejects → appends INTENTION_REJECTED event → returns structured error
//
// The agent sees the result, but the state change happened through the event log.

import type { ToolDefinition } from "../shared/types.js";
import { EventStore, type OrderState } from "./event-store.js";
import { Orchestrator, type Intention } from "./orchestrator.js";

// ─── Shared Instances ────────────────────────────────────────────────────────
//
// Single event store and orchestrator shared across all tool calls within a session.

export const eventStore = new EventStore();
export const orchestrator = new Orchestrator(eventStore);

let orderCounter = 1;

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "create_order",
      description:
        "Create a new e-commerce order with items and a shipping address. Each item needs a name, price (number), and quantity (number).",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "string",
            description: 'JSON array of items, e.g. [{"name":"Laptop","price":999,"quantity":1}]',
          },
          address: {
            type: "string",
            description: "Shipping address for the order",
          },
        },
        required: ["items", "address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_address",
      description:
        "Change the shipping address of an existing order. Will be rejected if the order has already shipped.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to modify",
          },
          new_address: {
            type: "string",
            description: "The new shipping address",
          },
        },
        required: ["order_id", "new_address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_item",
      description:
        "Add an item to an existing order. Will be rejected if the order is already confirmed or shipped.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to modify",
          },
          item_name: {
            type: "string",
            description: "Name of the item to add",
          },
          item_price: {
            type: "string",
            description: "Price of the item (number)",
          },
          item_quantity: {
            type: "string",
            description: "Quantity to add (number)",
          },
        },
        required: ["order_id", "item_name", "item_price", "item_quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_discount",
      description:
        "Apply a discount code to an order. Known codes: SAVE10 (10%), SAVE20 (20%), VIP25 (25%), WELCOME15 (15%). Rejected if order is already confirmed.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID",
          },
          discount_code: {
            type: "string",
            description: "The discount code to apply",
          },
        },
        required: ["order_id", "discount_code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_order",
      description:
        "Confirm an order for processing. After confirmation, no more items or discounts can be added.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to confirm",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ship_order",
      description:
        "Mark an order as shipped. Must be confirmed first. After shipping, the address cannot be changed.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to ship",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_status",
      description:
        "Get the current status and details of an order. This reads from the projected state (no event emitted).",
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
];

// ─── Tool Implementations ────────────────────────────────────────────────────

function formatOrder(order: OrderState): string {
  const lines = [
    `Order ${order.orderId} (${order.status})`,
    `  Address: ${order.address}`,
    `  Items:`,
    ...order.items.map((i) => `    - ${i.name} x${i.quantity} @ $${i.price}`),
  ];
  if (order.discounts.length > 0) {
    lines.push(
      `  Discounts: ${order.discounts.map((d) => `${d.code} (${d.percent}%)`).join(", ")}`,
    );
  }
  lines.push(`  Subtotal: $${order.totalBeforeDiscount}`);
  if (order.totalAfterDiscount !== order.totalBeforeDiscount) {
    lines.push(`  Total after discounts: $${order.totalAfterDiscount}`);
  }
  return lines.join("\n");
}

function processIntention(intention: Intention): string {
  const result = orchestrator.processIntention(intention);

  if (result.accepted) {
    const lines = [`[Event #${result.seq}] ${result.event.type} — accepted`];
    if (result.order) {
      lines.push(formatOrder(result.order));
    }
    return lines.join("\n");
  }

  if (result.event.type === "INTENTION_REJECTED") {
    return `[Event #${result.seq}] REJECTED — ${result.event.payload.reason}`;
  }

  return `[Event #${result.seq}] ${result.event.type}`;
}

function createOrder(args: { items: string; address: string }): string {
  let items: Array<{ name: string; price: number; quantity: number }>;
  try {
    items = JSON.parse(args.items);
  } catch {
    return (
      "Error: Could not parse items JSON. Provide a JSON array like: " +
      '[{"name":"Laptop","price":999,"quantity":1}]'
    );
  }

  const orderId = `ORD-${String(orderCounter++).padStart(3, "0")}`;
  const intention: Intention = {
    action: "CREATE_ORDER",
    orderId,
    items,
    address: args.address,
  };
  return processIntention(intention);
}

function changeAddress(args: { order_id: string; new_address: string }): string {
  const intention: Intention = {
    action: "CHANGE_ADDRESS",
    orderId: args.order_id,
    newAddress: args.new_address,
  };
  return processIntention(intention);
}

function addItem(args: {
  order_id: string;
  item_name: string;
  item_price: string;
  item_quantity: string;
}): string {
  const intention: Intention = {
    action: "ADD_ITEM",
    orderId: args.order_id,
    item: {
      name: args.item_name,
      price: Number.parseFloat(args.item_price) || 0,
      quantity: Number.parseInt(args.item_quantity, 10) || 1,
    },
  };
  return processIntention(intention);
}

function applyDiscount(args: { order_id: string; discount_code: string }): string {
  const intention: Intention = {
    action: "APPLY_DISCOUNT",
    orderId: args.order_id,
    code: args.discount_code,
  };
  return processIntention(intention);
}

function confirmOrder(args: { order_id: string }): string {
  const intention: Intention = {
    action: "CONFIRM_ORDER",
    orderId: args.order_id,
  };
  return processIntention(intention);
}

function shipOrder(args: { order_id: string }): string {
  const intention: Intention = {
    action: "SHIP_ORDER",
    orderId: args.order_id,
  };
  return processIntention(intention);
}

function getOrderStatus(args: { order_id: string }): string {
  const state = eventStore.projectState();
  const order = state.orders.get(args.order_id);
  if (!order) {
    return `Order ${args.order_id} not found`;
  }
  return formatOrder(order);
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "create_order":
      return createOrder(args as Parameters<typeof createOrder>[0]);
    case "change_address":
      return changeAddress(args as Parameters<typeof changeAddress>[0]);
    case "add_item":
      return addItem(args as Parameters<typeof addItem>[0]);
    case "apply_discount":
      return applyDiscount(args as Parameters<typeof applyDiscount>[0]);
    case "confirm_order":
      return confirmOrder(args as Parameters<typeof confirmOrder>[0]);
    case "ship_order":
      return shipOrder(args as Parameters<typeof shipOrder>[0]);
    case "get_order_status":
      return getOrderStatus(args as Parameters<typeof getOrderStatus>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
