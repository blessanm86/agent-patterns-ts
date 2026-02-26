import type { ToolDefinition } from "../shared/types.js";
import type { Customer, Product, Order, Category } from "./types.js";

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "lookup_customer",
      description:
        "Look up a customer by name, ID, or email. Returns customer profile including " +
        "membership tier, join date, and order count. Use this when the user asks about " +
        "a specific person or customer account.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search query — can be a customer name (partial match), " +
              "ID (e.g. USR-1001), or email address.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the product catalog by name or keyword. Optionally filter by category ID. " +
        "Returns matching products with price, stock status, and rating. " +
        "Use this when the user asks about products, items, or what's available.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search keyword for product name (partial match).",
          },
          category_id: {
            type: "string",
            description:
              "Optional category ID to filter by (e.g. CAT-301). " +
              "Use list_categories first to discover valid IDs.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order",
      description:
        "Get full details of a specific order by ID, including line items, " +
        "status, customer info, and total. Use this when the user asks about " +
        "a specific order or wants to check order status.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID, e.g. ORD-5001.",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_categories",
      description:
        "List all product categories with their product counts. " +
        "Use this when the user asks about categories, departments, or " +
        "wants to browse by category. Also useful before search_products " +
        "to find valid category IDs.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ─── Mock Data ──────────────────────────────────────────────────────────────

const CUSTOMERS: Customer[] = [
  {
    id: "USR-1001",
    name: "Alice Johnson",
    email: "alice@example.com",
    tier: "vip",
    since: "2022-03-15",
    totalOrders: 47,
  },
  {
    id: "USR-1002",
    name: "Bob Martinez",
    email: "bob.m@example.com",
    tier: "premium",
    since: "2023-01-20",
    totalOrders: 23,
  },
  {
    id: "USR-1003",
    name: "Carol Chen",
    email: "carol.chen@example.com",
    tier: "standard",
    since: "2024-06-10",
    totalOrders: 5,
  },
  {
    id: "USR-1004",
    name: "David Kim",
    email: "dkim@example.com",
    tier: "premium",
    since: "2023-08-01",
    totalOrders: 18,
  },
  {
    id: "USR-1005",
    name: "Eva Rossi",
    email: "eva.rossi@example.com",
    tier: "vip",
    since: "2021-11-05",
    totalOrders: 62,
  },
  {
    id: "USR-1006",
    name: "Frank Nguyen",
    email: "frank.n@example.com",
    tier: "standard",
    since: "2025-01-15",
    totalOrders: 2,
  },
];

const CATEGORIES: Category[] = [
  {
    id: "CAT-301",
    name: "Electronics",
    productCount: 4,
    description: "Phones, headphones, speakers, and accessories",
  },
  {
    id: "CAT-302",
    name: "Home & Kitchen",
    productCount: 3,
    description: "Appliances, cookware, and home essentials",
  },
  {
    id: "CAT-303",
    name: "Sports & Outdoors",
    productCount: 2,
    description: "Fitness equipment, outdoor gear, and activewear",
  },
  {
    id: "CAT-304",
    name: "Books & Media",
    productCount: 2,
    description: "Books, e-readers, and digital media",
  },
];

const PRODUCTS: Product[] = [
  {
    id: "PROD-2001",
    name: "Wireless Headphones",
    price: 79.99,
    category: "CAT-301",
    inStock: true,
    rating: 4.5,
  },
  {
    id: "PROD-2002",
    name: "Bluetooth Speaker",
    price: 49.99,
    category: "CAT-301",
    inStock: true,
    rating: 4.2,
  },
  {
    id: "PROD-2003",
    name: "USB-C Charging Cable",
    price: 12.99,
    category: "CAT-301",
    inStock: true,
    rating: 4.0,
  },
  {
    id: "PROD-2004",
    name: "Smart Watch",
    price: 199.99,
    category: "CAT-301",
    inStock: false,
    rating: 4.7,
  },
  {
    id: "PROD-2005",
    name: "Stainless Steel Water Bottle",
    price: 24.99,
    category: "CAT-303",
    inStock: true,
    rating: 4.8,
  },
  {
    id: "PROD-2006",
    name: "Yoga Mat",
    price: 34.99,
    category: "CAT-303",
    inStock: true,
    rating: 4.3,
  },
  {
    id: "PROD-2007",
    name: "Cast Iron Skillet",
    price: 39.99,
    category: "CAT-302",
    inStock: true,
    rating: 4.9,
  },
  {
    id: "PROD-2008",
    name: "Electric Kettle",
    price: 29.99,
    category: "CAT-302",
    inStock: true,
    rating: 4.4,
  },
  {
    id: "PROD-2009",
    name: "Air Purifier",
    price: 149.99,
    category: "CAT-302",
    inStock: false,
    rating: 4.6,
  },
  {
    id: "PROD-2010",
    name: "E-Reader",
    price: 129.99,
    category: "CAT-304",
    inStock: true,
    rating: 4.5,
  },
  {
    id: "PROD-2011",
    name: "Desk Lamp with USB",
    price: 44.99,
    category: "CAT-304",
    inStock: true,
    rating: 4.1,
  },
];

const ORDERS: Order[] = [
  {
    id: "ORD-5001",
    customerId: "USR-1001",
    customerName: "Alice Johnson",
    status: "shipped",
    items: [
      { productId: "PROD-2001", productName: "Wireless Headphones", quantity: 1, unitPrice: 79.99 },
      {
        productId: "PROD-2003",
        productName: "USB-C Charging Cable",
        quantity: 2,
        unitPrice: 12.99,
      },
    ],
    total: 105.97,
    createdAt: "2026-02-20",
  },
  {
    id: "ORD-5002",
    customerId: "USR-1001",
    customerName: "Alice Johnson",
    status: "delivered",
    items: [
      { productId: "PROD-2007", productName: "Cast Iron Skillet", quantity: 1, unitPrice: 39.99 },
    ],
    total: 39.99,
    createdAt: "2026-02-10",
  },
  {
    id: "ORD-5003",
    customerId: "USR-1002",
    customerName: "Bob Martinez",
    status: "processing",
    items: [
      { productId: "PROD-2002", productName: "Bluetooth Speaker", quantity: 1, unitPrice: 49.99 },
      {
        productId: "PROD-2005",
        productName: "Stainless Steel Water Bottle",
        quantity: 2,
        unitPrice: 24.99,
      },
    ],
    total: 99.97,
    createdAt: "2026-02-24",
  },
  {
    id: "ORD-5004",
    customerId: "USR-1003",
    customerName: "Carol Chen",
    status: "pending",
    items: [{ productId: "PROD-2004", productName: "Smart Watch", quantity: 1, unitPrice: 199.99 }],
    total: 199.99,
    createdAt: "2026-02-25",
  },
  {
    id: "ORD-5005",
    customerId: "USR-1004",
    customerName: "David Kim",
    status: "delivered",
    items: [
      { productId: "PROD-2010", productName: "E-Reader", quantity: 1, unitPrice: 129.99 },
      { productId: "PROD-2008", productName: "Electric Kettle", quantity: 1, unitPrice: 29.99 },
    ],
    total: 159.98,
    createdAt: "2026-02-15",
  },
  {
    id: "ORD-5006",
    customerId: "USR-1005",
    customerName: "Eva Rossi",
    status: "shipped",
    items: [
      { productId: "PROD-2006", productName: "Yoga Mat", quantity: 1, unitPrice: 34.99 },
      {
        productId: "PROD-2005",
        productName: "Stainless Steel Water Bottle",
        quantity: 1,
        unitPrice: 24.99,
      },
    ],
    total: 59.98,
    createdAt: "2026-02-22",
  },
  {
    id: "ORD-5007",
    customerId: "USR-1005",
    customerName: "Eva Rossi",
    status: "cancelled",
    items: [
      { productId: "PROD-2009", productName: "Air Purifier", quantity: 1, unitPrice: 149.99 },
    ],
    total: 149.99,
    createdAt: "2026-02-18",
  },
  {
    id: "ORD-5008",
    customerId: "USR-1006",
    customerName: "Frank Nguyen",
    status: "delivered",
    items: [
      { productId: "PROD-2011", productName: "Desk Lamp with USB", quantity: 1, unitPrice: 44.99 },
    ],
    total: 44.99,
    createdAt: "2026-02-12",
  },
];

// ─── Tool Implementations ───────────────────────────────────────────────────

function lookupCustomer(args: Record<string, string>): string {
  const query = (args.query ?? "").toLowerCase();
  const matches = CUSTOMERS.filter(
    (c) =>
      c.name.toLowerCase().includes(query) ||
      c.id.toLowerCase() === query ||
      c.email.toLowerCase() === query,
  );

  if (matches.length === 0) {
    return `No customers found matching "${args.query}".`;
  }

  // Include recent orders for matched customers
  const results = matches.map((c) => {
    const orders = ORDERS.filter((o) => o.customerId === c.id)
      .slice(0, 3)
      .map((o) => `${o.id} (${o.status}, $${o.total.toFixed(2)})`);
    return (
      `Customer: ${c.name} (${c.id}), email: ${c.email}, tier: ${c.tier}, ` +
      `member since: ${c.since}, total orders: ${c.totalOrders}` +
      (orders.length > 0 ? `. Recent orders: ${orders.join(", ")}` : "")
    );
  });

  return results.join("\n");
}

function searchProducts(args: Record<string, string>): string {
  const query = (args.query ?? "").toLowerCase();
  let matches = PRODUCTS.filter((p) => p.name.toLowerCase().includes(query));

  if (args.category_id) {
    matches =
      matches.length > 0
        ? matches.filter((p) => p.category === args.category_id)
        : PRODUCTS.filter((p) => p.category === args.category_id);
  }

  if (matches.length === 0) {
    return `No products found matching "${args.query}"${args.category_id ? ` in category ${args.category_id}` : ""}.`;
  }

  const categoryName = (id: string) => CATEGORIES.find((c) => c.id === id)?.name ?? id;

  return matches
    .map(
      (p) =>
        `${p.name} (${p.id}): $${p.price.toFixed(2)}, category: ${categoryName(p.category)} (${p.category}), ` +
        `${p.inStock ? "in stock" : "OUT OF STOCK"}, rating: ${p.rating}/5`,
    )
    .join("\n");
}

function getOrder(args: Record<string, string>): string {
  const orderId = args.order_id?.toUpperCase();
  const order = ORDERS.find((o) => o.id === orderId);

  if (!order) {
    return `Order "${args.order_id}" not found. Valid order IDs: ${ORDERS.map((o) => o.id).join(", ")}`;
  }

  const items = order.items
    .map((i) => `  - ${i.productName} (${i.productId}) x${i.quantity} @ $${i.unitPrice.toFixed(2)}`)
    .join("\n");

  return (
    `Order ${order.id}: status=${order.status}, customer=${order.customerName} (${order.customerId}), ` +
    `total=$${order.total.toFixed(2)}, placed=${order.createdAt}\n` +
    `Items:\n${items}`
  );
}

function listCategories(): string {
  return CATEGORIES.map(
    (c) => `${c.name} (${c.id}): ${c.productCount} products — ${c.description}`,
  ).join("\n");
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "lookup_customer":
      return lookupCustomer(args);
    case "search_products":
      return searchProducts(args);
    case "get_order":
      return getOrder(args);
    case "list_categories":
      return listCategories();
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

/**
 * Collect all entity IDs that appear in a tool result string.
 * Used to calculate tag hit rate — how many IDs from tool output
 * got proper entity tags in the LLM response.
 */
export function extractIdsFromToolResult(result: string): Set<string> {
  const ids = new Set<string>();
  const patterns = [/USR-\d+/g, /PROD-\d+/g, /ORD-\d+/g, /CAT-\d+/g];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(result)) !== null) {
      ids.add(match[0]);
    }
  }
  return ids;
}
