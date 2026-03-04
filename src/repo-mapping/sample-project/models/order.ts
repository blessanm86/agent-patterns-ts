// ─── Order Model ────────────────────────────────────────────────────────────

import type { User } from "./user.js";
import type { Product } from "./product.js";

export enum OrderStatus {
  Pending = "pending",
  Confirmed = "confirmed",
  Shipped = "shipped",
  Delivered = "delivered",
  Cancelled = "cancelled",
}

export interface OrderItem {
  product: Product;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  customer: User;
  items: OrderItem[];
  status: OrderStatus;
  total: number;
  createdAt: Date;
}

export function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export function formatOrderSummary(order: Order): string {
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return `Order ${order.id}: ${itemCount} items, $${order.total.toFixed(2)} [${order.status}]`;
}
