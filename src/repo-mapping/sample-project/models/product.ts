// ─── Product Catalog ────────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: ProductCategory;
  inStock: boolean;
}

export type ProductCategory = "electronics" | "clothing" | "books" | "food";

export function createProduct(data: Omit<Product, "id">): Product {
  return {
    id: `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...data,
  };
}

export function formatProductPrice(product: Product): string {
  return `$${product.price.toFixed(2)}`;
}

export const FEATURED_PRODUCTS: Product[] = [
  {
    id: "prod_001",
    name: "TypeScript Handbook",
    description: "The definitive guide to TypeScript",
    price: 39.99,
    category: "books",
    inStock: true,
  },
  {
    id: "prod_002",
    name: "Mechanical Keyboard",
    description: "Cherry MX Brown switches, full-size",
    price: 149.99,
    category: "electronics",
    inStock: true,
  },
  {
    id: "prod_003",
    name: "Developer Hoodie",
    description: "Comfortable cotton blend, dark theme",
    price: 59.99,
    category: "clothing",
    inStock: false,
  },
];
