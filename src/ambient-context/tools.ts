import type { ToolDefinition } from "../shared/types.js";
import { PRODUCTS, ORDERS, cart, findProduct, getCartTotal, getCartItemCount } from "./data.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the product catalog by query string or category. Returns matching products with id, name, price, and availability.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term to match against product names and descriptions",
          },
          category: {
            type: "string",
            description: "Filter by category",
            enum: ["electronics", "kitchen", "outdoor"],
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product_details",
      description: "Get full details for a specific product by its ID (e.g. P001).",
      parameters: {
        type: "object",
        properties: {
          product_id: {
            type: "string",
            description: "The product ID (e.g. P001)",
          },
        },
        required: ["product_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description: "Add a product to the shopping cart by product ID.",
      parameters: {
        type: "object",
        properties: {
          product_id: {
            type: "string",
            description: "The product ID to add",
          },
          quantity: {
            type: "string",
            description: "Number of items to add (default: 1)",
          },
        },
        required: ["product_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_from_cart",
      description: "Remove a product from the shopping cart by product ID.",
      parameters: {
        type: "object",
        properties: {
          product_id: {
            type: "string",
            description: "The product ID to remove",
          },
        },
        required: ["product_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cart",
      description: "Get current shopping cart contents with items, quantities, and total.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_history",
      description: "Get the user's past orders with dates, items, totals, and status.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ─── Tool Implementations ────────────────────────────────────────────────────

function searchProducts(args: { query?: string; category?: string }): string {
  let results = [...PRODUCTS];

  if (args.category) {
    results = results.filter((p) => p.category === args.category);
  }

  if (args.query) {
    const q = args.query.toLowerCase();
    results = results.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    );
  }

  if (results.length === 0) {
    return JSON.stringify({ results: [], message: "No products found matching your search" });
  }

  return JSON.stringify({
    results: results.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      category: p.category,
      inStock: p.inStock,
    })),
    count: results.length,
  });
}

function getProductDetails(args: { product_id: string }): string {
  const product = findProduct(args.product_id);
  if (!product) {
    return JSON.stringify({ error: `Product not found: ${args.product_id}` });
  }
  return JSON.stringify(product);
}

function addToCart(args: { product_id: string; quantity?: string }): string {
  const product = findProduct(args.product_id);
  if (!product) {
    return JSON.stringify({ error: `Product not found: ${args.product_id}` });
  }
  if (!product.inStock) {
    return JSON.stringify({ error: `${product.name} is out of stock` });
  }

  const qty = parseInt(args.quantity ?? "1", 10) || 1;
  const existing = cart.find((i) => i.productId === args.product_id);

  if (existing) {
    existing.quantity += qty;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: qty,
    });
  }

  return JSON.stringify({
    added: product.name,
    quantity: qty,
    cartTotal: getCartTotal().toFixed(2),
    cartItemCount: getCartItemCount(),
  });
}

function removeFromCart(args: { product_id: string }): string {
  const idx = cart.findIndex((i) => i.productId === args.product_id);
  if (idx === -1) {
    return JSON.stringify({ error: `Product ${args.product_id} is not in the cart` });
  }

  const removed = cart.splice(idx, 1)[0];
  return JSON.stringify({
    removed: removed.name,
    cartTotal: getCartTotal().toFixed(2),
    cartItemCount: getCartItemCount(),
  });
}

function getCart(): string {
  if (cart.length === 0) {
    return JSON.stringify({ items: [], total: "0.00", itemCount: 0 });
  }

  return JSON.stringify({
    items: cart.map((i) => ({
      productId: i.productId,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      subtotal: (i.price * i.quantity).toFixed(2),
    })),
    total: getCartTotal().toFixed(2),
    itemCount: getCartItemCount(),
  });
}

function getOrderHistory(): string {
  return JSON.stringify({
    orders: ORDERS.map((o) => ({
      id: o.id,
      date: o.date,
      items: o.items,
      total: o.total,
      status: o.status,
    })),
    totalOrders: ORDERS.length,
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_products":
      return searchProducts(args);
    case "get_product_details":
      return getProductDetails(args as { product_id: string });
    case "add_to_cart":
      return addToCart(args as { product_id: string; quantity?: string });
    case "remove_from_cart":
      return removeFromCart(args as { product_id: string });
    case "get_cart":
      return getCart();
    case "get_order_history":
      return getOrderHistory();
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
