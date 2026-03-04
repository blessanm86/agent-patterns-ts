// ─── Order Processing Service ───────────────────────────────────────────────

import type { User } from "../models/user.js";
import type { Product } from "../models/product.js";
import type { Order, OrderItem } from "../models/order.js";
import { OrderStatus, calculateOrderTotal, formatOrderSummary } from "../models/order.js";
import { reserveStock, releaseStock, getAvailableQuantity } from "./inventory.js";
import { validateQuantity } from "../utils/validators.js";
import { formatCurrency } from "../utils/formatters.js";

const orders = new Map<string, Order>();

export interface CreateOrderInput {
  customer: User;
  items: { product: Product; quantity: number }[];
}

export function createOrder(input: CreateOrderInput): Order | { error: string } {
  // Validate quantities
  for (const item of input.items) {
    if (!validateQuantity(item.quantity)) {
      return { error: `Invalid quantity for ${item.product.name}` };
    }
  }

  // Check and reserve stock
  const reserved: { productId: string; quantity: number }[] = [];
  for (const item of input.items) {
    const available = getAvailableQuantity(item.product.id);
    if (available < item.quantity) {
      // Rollback reservations
      for (const r of reserved) {
        releaseStock(r.productId, r.quantity);
      }
      return { error: `Insufficient stock for ${item.product.name} (available: ${available})` };
    }
    reserveStock(item.product.id, item.quantity);
    reserved.push({ productId: item.product.id, quantity: item.quantity });
  }

  const orderItems: OrderItem[] = input.items.map((item) => ({
    product: item.product,
    quantity: item.quantity,
    unitPrice: item.product.price,
  }));

  const order: Order = {
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    customer: input.customer,
    items: orderItems,
    status: OrderStatus.Pending,
    total: calculateOrderTotal(orderItems),
    createdAt: new Date(),
  };

  orders.set(order.id, order);
  return order;
}

export function getOrder(orderId: string): Order | null {
  return orders.get(orderId) ?? null;
}

export function cancelOrder(orderId: string): boolean {
  const order = orders.get(orderId);
  if (!order || order.status !== OrderStatus.Pending) return false;

  // Release reserved stock
  for (const item of order.items) {
    releaseStock(item.product.id, item.quantity);
  }
  order.status = OrderStatus.Cancelled;
  return true;
}

export function getOrderSummary(orderId: string): string | null {
  const order = orders.get(orderId);
  if (!order) return null;
  const summary = formatOrderSummary(order);
  const totalFormatted = formatCurrency(order.total);
  return `${summary} | Total: ${totalFormatted}`;
}
