// ─── Inventory Management ───────────────────────────────────────────────────

import { FEATURED_PRODUCTS } from "../models/product.js";

export interface StockEntry {
  productId: string;
  quantity: number;
  reservedQuantity: number;
  lastRestocked: Date;
}

const stock = new Map<string, StockEntry>();

// Initialize stock for featured products
for (const product of FEATURED_PRODUCTS) {
  stock.set(product.id, {
    productId: product.id,
    quantity: product.inStock ? 50 : 0,
    reservedQuantity: 0,
    lastRestocked: new Date(),
  });
}

export function checkStock(productId: string): StockEntry | null {
  return stock.get(productId) ?? null;
}

export function getAvailableQuantity(productId: string): number {
  const entry = stock.get(productId);
  if (!entry) return 0;
  return entry.quantity - entry.reservedQuantity;
}

export function reserveStock(productId: string, quantity: number): boolean {
  const entry = stock.get(productId);
  if (!entry) return false;
  const available = entry.quantity - entry.reservedQuantity;
  if (available < quantity) return false;

  entry.reservedQuantity += quantity;
  return true;
}

export function releaseStock(productId: string, quantity: number): void {
  const entry = stock.get(productId);
  if (!entry) return;
  entry.reservedQuantity = Math.max(0, entry.reservedQuantity - quantity);
}

export function restockProduct(productId: string, quantity: number): void {
  const entry = stock.get(productId);
  if (entry) {
    entry.quantity += quantity;
    entry.lastRestocked = new Date();
  } else {
    stock.set(productId, {
      productId,
      quantity,
      reservedQuantity: 0,
      lastRestocked: new Date(),
    });
  }
}
