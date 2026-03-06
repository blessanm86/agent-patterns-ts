import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_menu",
      description:
        "Get the restaurant menu. Returns categories with items, prices, and dietary tags.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Optional category filter",
            enum: ["appetizers", "mains", "desserts", "drinks"],
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_order",
      description:
        "Place an order for one or more menu items. Returns an order confirmation with total price.",
      parameters: {
        type: "object",
        properties: {
          customer_name: {
            type: "string",
            description: "Name for the order",
          },
          items: {
            type: "string",
            description: 'Comma-separated list of item names (e.g. "Caesar Salad, Grilled Salmon")',
          },
        },
        required: ["customer_name", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_order_status",
      description: "Check the status of an existing order by order ID.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID (e.g. ORD-1001)",
          },
        },
        required: ["order_id"],
      },
    },
  },
];

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface MenuItem {
  name: string;
  price: number;
  tags: string[];
}

const MENU: Record<string, MenuItem[]> = {
  appetizers: [
    { name: "Caesar Salad", price: 9.5, tags: ["vegetarian"] },
    { name: "Bruschetta", price: 8.0, tags: ["vegetarian", "vegan"] },
    { name: "Shrimp Cocktail", price: 14.0, tags: ["gluten-free"] },
  ],
  mains: [
    { name: "Grilled Salmon", price: 24.0, tags: ["gluten-free"] },
    { name: "Mushroom Risotto", price: 18.0, tags: ["vegetarian"] },
    { name: "Ribeye Steak", price: 32.0, tags: ["gluten-free"] },
    { name: "Veggie Burger", price: 15.0, tags: ["vegetarian", "vegan"] },
  ],
  desserts: [
    { name: "Tiramisu", price: 10.0, tags: [] },
    { name: "Fruit Sorbet", price: 7.0, tags: ["vegan", "gluten-free"] },
  ],
  drinks: [
    { name: "Sparkling Water", price: 3.0, tags: [] },
    { name: "Fresh Lemonade", price: 5.0, tags: ["vegan"] },
    { name: "Espresso", price: 4.0, tags: ["vegan"] },
  ],
};

interface Order {
  orderId: string;
  customerName: string;
  items: { name: string; price: number }[];
  total: number;
  status: "preparing" | "ready" | "delivered";
}

const orders: Map<string, Order> = new Map();
let orderCounter = 1000;

// ─── Tool Implementations ────────────────────────────────────────────────────

function getMenu(args: { category?: string }): string {
  if (args.category && MENU[args.category]) {
    return JSON.stringify({ [args.category]: MENU[args.category] });
  }
  return JSON.stringify(MENU);
}

function placeOrder(args: { customer_name: string; items: string }): string {
  const requestedItems = args.items.split(",").map((s) => s.trim().toLowerCase());
  const allItems = Object.values(MENU).flat();
  const matched: { name: string; price: number }[] = [];
  const notFound: string[] = [];

  for (const req of requestedItems) {
    const found = allItems.find((m) => m.name.toLowerCase() === req);
    if (found) {
      matched.push({ name: found.name, price: found.price });
    } else {
      notFound.push(req);
    }
  }

  if (matched.length === 0) {
    return JSON.stringify({ error: "No valid menu items found", requested: requestedItems });
  }

  orderCounter++;
  const orderId = `ORD-${orderCounter}`;
  const total = matched.reduce((sum, item) => sum + item.price, 0);
  const order: Order = {
    orderId,
    customerName: args.customer_name,
    items: matched,
    total,
    status: "preparing",
  };
  orders.set(orderId, order);

  return JSON.stringify({
    success: true,
    orderId,
    items: matched,
    total,
    ...(notFound.length > 0 ? { warnings: `Items not found: ${notFound.join(", ")}` } : {}),
  });
}

function checkOrderStatus(args: { order_id: string }): string {
  const order = orders.get(args.order_id);
  if (!order) {
    return JSON.stringify({ error: `Order ${args.order_id} not found` });
  }
  return JSON.stringify({
    orderId: order.orderId,
    customerName: order.customerName,
    items: order.items.map((i) => i.name),
    total: order.total,
    status: order.status,
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "get_menu":
      return getMenu(args as Parameters<typeof getMenu>[0]);
    case "place_order":
      return placeOrder(args as Parameters<typeof placeOrder>[0]);
    case "check_order_status":
      return checkOrderStatus(args as Parameters<typeof checkOrderStatus>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
