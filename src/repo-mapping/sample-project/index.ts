// ─── E-Commerce App Entry Point ─────────────────────────────────────────────

import { formatUserDisplay } from "./models/user.js";
import { FEATURED_PRODUCTS, formatProductPrice } from "./models/product.js";
import { registerUser, authenticate } from "./services/auth.js";
import { createOrder, getOrderSummary } from "./services/order-service.js";
import { checkStock } from "./services/inventory.js";
import { formatCurrency } from "./utils/formatters.js";

export function bootstrapApp(): void {
  // Register a demo user
  const user = registerUser({ email: "alice@example.com", name: "Alice Johnson" }, "SecurePass1");
  if ("error" in user) {
    console.error("Registration failed:", user.error);
    return;
  }

  console.log("Registered:", formatUserDisplay(user));

  // Authenticate
  const auth = authenticate("alice@example.com", "SecurePass1");
  if ("error" in auth) {
    console.error("Auth failed:", auth.error);
    return;
  }
  console.log("Authenticated, token:", auth.token.slice(0, 10) + "...");

  // Browse products
  console.log("\nFeatured Products:");
  for (const product of FEATURED_PRODUCTS) {
    const stock = checkStock(product.id);
    const available = stock ? stock.quantity - stock.reservedQuantity : 0;
    console.log(`  ${product.name} - ${formatProductPrice(product)} (${available} in stock)`);
  }

  // Place an order
  const inStockProducts = FEATURED_PRODUCTS.filter((p) => p.inStock);
  const order = createOrder({
    customer: auth.user,
    items: inStockProducts.map((p) => ({ product: p, quantity: 1 })),
  });

  if ("error" in order) {
    console.error("Order failed:", order.error);
    return;
  }

  const summary = getOrderSummary(order.id);
  console.log("\nOrder placed:", summary);
  console.log("Total:", formatCurrency(order.total));
}
