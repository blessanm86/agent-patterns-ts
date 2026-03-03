import type { Page, ContextStore } from "./types.js";
import {
  PRODUCTS,
  ORDERS,
  USER,
  cart,
  getCartTotal,
  getCartItemCount,
  findProduct,
} from "./data.js";

// ─── Page Definitions ────────────────────────────────────────────────────────
//
// Each page represents a "view" in the e-commerce app. When the user navigates
// to a page, it registers ambient contexts that describe what's on screen.
// When the user leaves, contexts are unregistered. This mirrors the
// mount/unmount lifecycle of UI components.
//
// The user:profile context is shared — it's registered by every page to
// simulate a persistent sidebar. This demonstrates reference counting: the
// account page adds a second reference, so leaving account doesn't remove it.

function registerUserContext(store: ContextStore, source: string): void {
  store.register(
    "user",
    "profile",
    {
      name: USER.name,
      email: USER.email,
      tier: USER.tier,
      memberSince: USER.memberSince,
    },
    source,
  );
}

function unregisterUserContext(store: ContextStore, source: string): void {
  store.unregister("user", "profile", source);
}

// ─── Catalog Page ────────────────────────────────────────────────────────────

const catalogPage: Page = {
  name: "catalog",
  title: "Product Catalog",

  register(store) {
    registerUserContext(store, "catalog");
    store.register(
      "category",
      "all",
      {
        name: "All Categories",
        categories: "electronics, kitchen, outdoor",
        totalProducts: String(PRODUCTS.length),
      },
      "catalog",
    );
    store.register(
      "filter",
      "in-stock",
      {
        name: "In Stock Only",
        status: "active",
        matchCount: String(PRODUCTS.filter((p) => p.inStock).length),
      },
      "catalog",
    );
  },

  unregister(store) {
    unregisterUserContext(store, "catalog");
    store.unregister("category", "all", "catalog");
    store.unregister("filter", "in-stock", "catalog");
  },

  display() {
    const lines = [
      "\n  ╭─────────────────────────────────────╮",
      "  │         Product Catalog             │",
      "  ╰─────────────────────────────────────╯\n",
    ];
    for (const p of PRODUCTS) {
      const stock = p.inStock ? "In Stock" : "Out of Stock";
      lines.push(`  ${p.id}  $${p.price.toFixed(2).padEnd(8)} ${p.name} (${stock})`);
    }
    lines.push(`\n  ${PRODUCTS.length} products across 3 categories`);
    lines.push("  Use /product <id> to view details");
    return lines.join("\n");
  },
};

// ─── Product Detail Page ─────────────────────────────────────────────────────

const productPage: Page = {
  name: "product",
  title: "Product Details",

  register(store, args) {
    registerUserContext(store, "product");
    const product = args ? findProduct(args) : undefined;
    if (product) {
      store.register(
        "product",
        product.id,
        {
          name: product.name,
          price: String(product.price),
          category: product.category,
          description: product.description,
          inStock: String(product.inStock),
        },
        "product",
      );
    }
  },

  unregister(store, args) {
    unregisterUserContext(store, "product");
    if (args) {
      store.unregister("product", args, "product");
    }
  },

  display(args) {
    const product = args ? findProduct(args) : undefined;
    if (!product) {
      return `\n  Product not found: ${args ?? "(no id)"}. Use /catalog to browse.`;
    }
    const stock = product.inStock ? "In Stock" : "Out of Stock";
    return [
      "\n  ╭─────────────────────────────────────╮",
      `  │  ${product.name.padEnd(35)}│`,
      "  ╰─────────────────────────────────────╯\n",
      `  ID:          ${product.id}`,
      `  Price:       $${product.price.toFixed(2)}`,
      `  Category:    ${product.category}`,
      `  Status:      ${stock}`,
      `  Description: ${product.description}`,
      "\n  Use /cart to add items or /catalog to browse",
    ].join("\n");
  },
};

// ─── Cart Page ───────────────────────────────────────────────────────────────

const cartPage: Page = {
  name: "cart",
  title: "Shopping Cart",

  register(store) {
    registerUserContext(store, "cart");
    const items = cart.map((i) => `${i.name} x${i.quantity}`).join(", ");
    store.register(
      "cart",
      "current",
      {
        name: "Shopping Cart",
        itemCount: String(getCartItemCount()),
        total: getCartTotal().toFixed(2),
        items: items || "(empty)",
      },
      "cart",
    );
  },

  unregister(store) {
    unregisterUserContext(store, "cart");
    store.unregister("cart", "current", "cart");
  },

  display() {
    const lines = [
      "\n  ╭─────────────────────────────────────╮",
      "  │           Shopping Cart              │",
      "  ╰─────────────────────────────────────╯\n",
    ];
    if (cart.length === 0) {
      lines.push("  (empty cart)");
    } else {
      for (const item of cart) {
        lines.push(`  ${item.name} x${item.quantity}  $${(item.price * item.quantity).toFixed(2)}`);
      }
      lines.push(`\n  Total: $${getCartTotal().toFixed(2)} (${getCartItemCount()} items)`);
    }
    return lines.join("\n");
  },
};

// ─── Orders Page ─────────────────────────────────────────────────────────────

const ordersPage: Page = {
  name: "orders",
  title: "Order History",

  register(store) {
    registerUserContext(store, "orders");
    const summary = ORDERS.map((o) => `${o.id}: $${o.total.toFixed(2)} (${o.status})`).join("; ");
    store.register(
      "order",
      "recent",
      {
        name: "Recent Orders",
        count: String(ORDERS.length),
        summary,
        totalSpent: ORDERS.reduce((s, o) => s + o.total, 0).toFixed(2),
      },
      "orders",
    );
  },

  unregister(store) {
    unregisterUserContext(store, "orders");
    store.unregister("order", "recent", "orders");
  },

  display() {
    const lines = [
      "\n  ╭─────────────────────────────────────╮",
      "  │          Order History               │",
      "  ╰─────────────────────────────────────╯\n",
    ];
    for (const order of ORDERS) {
      const itemNames = order.items.map((i) => `${i.name} x${i.quantity}`).join(", ");
      lines.push(`  ${order.id}  ${order.date}  $${order.total.toFixed(2)}  [${order.status}]`);
      lines.push(`           ${itemNames}`);
    }
    return lines.join("\n");
  },
};

// ─── Account Page ────────────────────────────────────────────────────────────

const accountPage: Page = {
  name: "account",
  title: "Account Settings",

  register(store) {
    // This adds a SECOND reference to user:profile (catalog/other pages already have one).
    // Demonstrates reference counting: leaving account decrements but doesn't remove it.
    registerUserContext(store, "account");
  },

  unregister(store) {
    unregisterUserContext(store, "account");
  },

  display() {
    return [
      "\n  ╭─────────────────────────────────────╮",
      "  │         Account Settings             │",
      "  ╰─────────────────────────────────────╯\n",
      `  Name:         ${USER.name}`,
      `  Email:        ${USER.email}`,
      `  Membership:   ${USER.tier}`,
      `  Member since: ${USER.memberSince}`,
    ].join("\n");
  },
};

// ─── Page Registry ───────────────────────────────────────────────────────────

export const PAGES: Record<string, Page> = {
  catalog: catalogPage,
  product: productPage,
  cart: cartPage,
  orders: ordersPage,
  account: accountPage,
};

// ─── Navigation ──────────────────────────────────────────────────────────────

export interface NavigationState {
  currentPage: Page;
  currentArgs?: string;
}

export function navigateTo(
  state: NavigationState,
  store: ContextStore,
  pageName: string,
  args?: string,
): boolean {
  const page = PAGES[pageName];
  if (!page) return false;

  // Unregister current page's contexts
  state.currentPage.unregister(store, state.currentArgs);

  // Register new page's contexts
  page.register(store, args);

  state.currentPage = page;
  state.currentArgs = args;
  return true;
}
