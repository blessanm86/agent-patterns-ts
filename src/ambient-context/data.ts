import type { Product, CartItem, Order, UserProfile } from "./types.js";

// ─── Product Catalog ─────────────────────────────────────────────────────────

export const PRODUCTS: Product[] = [
  {
    id: "P001",
    name: "Studio Monitor Headphones",
    price: 79.99,
    category: "electronics",
    description:
      "Over-ear headphones with flat frequency response, ideal for music production and critical listening. 40mm drivers, detachable cable.",
    inStock: true,
  },
  {
    id: "P002",
    name: "Mechanical Keyboard",
    price: 129.99,
    category: "electronics",
    description:
      "Full-size mechanical keyboard with Cherry MX Brown switches, RGB backlighting, and USB-C connection.",
    inStock: true,
  },
  {
    id: "P003",
    name: "Portable Bluetooth Speaker",
    price: 49.99,
    category: "electronics",
    description:
      "Waterproof speaker with 12-hour battery life, 360-degree sound, and built-in microphone for calls.",
    inStock: true,
  },
  {
    id: "P004",
    name: "Cast Iron Skillet 12-inch",
    price: 34.99,
    category: "kitchen",
    description:
      "Pre-seasoned cast iron skillet, oven-safe to 500F. Works on all cooktops including induction.",
    inStock: true,
  },
  {
    id: "P005",
    name: "Chef's Knife Set",
    price: 89.99,
    category: "kitchen",
    description:
      "5-piece forged steel knife set with ergonomic handles. Includes chef's, bread, utility, paring knives and shears.",
    inStock: true,
  },
  {
    id: "P006",
    name: "Pour-Over Coffee Maker",
    price: 28.99,
    category: "kitchen",
    description:
      "Borosilicate glass carafe with stainless steel filter. Brews 4 cups. No paper filters needed.",
    inStock: false,
  },
  {
    id: "P007",
    name: "Ultralight Hiking Backpack",
    price: 149.99,
    category: "outdoor",
    description:
      "45L pack with aluminum frame, rain cover, and multiple compartments. Weighs only 2.1 lbs.",
    inStock: true,
  },
  {
    id: "P008",
    name: "Camping Hammock with Straps",
    price: 39.99,
    category: "outdoor",
    description:
      "Double-size ripstop nylon hammock supporting up to 500 lbs. Includes tree-friendly straps and carabiners.",
    inStock: true,
  },
  {
    id: "P009",
    name: "LED Headlamp",
    price: 24.99,
    category: "outdoor",
    description:
      "Rechargeable headlamp with 600 lumens, red-light mode, and IPX6 water resistance. 8-hour runtime.",
    inStock: true,
  },
  {
    id: "P010",
    name: "Wireless Charging Pad",
    price: 19.99,
    category: "electronics",
    description:
      "Qi-compatible 15W fast wireless charger. Slim design with LED indicator and anti-slip surface.",
    inStock: true,
  },
];

// ─── Shopping Cart (mutable) ─────────────────────────────────────────────────

export const cart: CartItem[] = [
  { productId: "P001", name: "Studio Monitor Headphones", price: 79.99, quantity: 1 },
  { productId: "P004", name: "Cast Iron Skillet 12-inch", price: 34.99, quantity: 1 },
];

// ─── Order History ───────────────────────────────────────────────────────────

export const ORDERS: Order[] = [
  {
    id: "ORD-1001",
    date: "2026-02-15",
    items: [
      { name: "Camping Hammock with Straps", quantity: 1, price: 39.99 },
      { name: "LED Headlamp", quantity: 2, price: 24.99 },
    ],
    total: 89.97,
    status: "delivered",
  },
  {
    id: "ORD-1002",
    date: "2026-02-22",
    items: [{ name: "Pour-Over Coffee Maker", quantity: 1, price: 28.99 }],
    total: 28.99,
    status: "delivered",
  },
  {
    id: "ORD-1003",
    date: "2026-03-01",
    items: [{ name: "Wireless Charging Pad", quantity: 2, price: 19.99 }],
    total: 39.98,
    status: "shipped",
  },
];

// ─── User Profile ────────────────────────────────────────────────────────────

export const USER: UserProfile = {
  name: "Alice Chen",
  email: "alice@example.com",
  tier: "premium",
  memberSince: "2024-06-15",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getCartTotal(): number {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function getCartItemCount(): number {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
