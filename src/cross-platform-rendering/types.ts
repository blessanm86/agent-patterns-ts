// ─── Entity Tag Types ─────────────────────────────────────────────────────────

export type EntityType = "User" | "Product" | "Order" | "Category";

export interface ParsedEntity {
  type: EntityType;
  id: string;
  name: string;
  attributes: Record<string, string>;
  /** Start index in the original string */
  start: number;
  /** End index in the original string (exclusive) */
  end: number;
}

export interface EntityStats {
  /** Count of each entity type found */
  counts: Record<EntityType, number>;
  /** All parsed entities */
  entities: ParsedEntity[];
  /** % of entity IDs from tool results that got proper tags */
  tagHitRate: number;
}

// ─── Platform Rendering Types ────────────────────────────────────────────────
//
// THE KEY TYPE — Record<EntityType, Handler> forces exhaustive handling.
// Adding a new EntityType causes compile errors in every renderer that
// doesn't handle it. Adding a new PlatformType causes a compile error
// in the renderer registry until a renderer is provided.

export type PlatformType = "terminal" | "markdown" | "slack" | "html";

/** Maps every entity type to a render function. Record forces exhaustiveness. */
export type EntityRendererMap = Record<EntityType, (entity: ParsedEntity) => string>;

export interface PlatformRenderer {
  name: string;
  entityRenderers: EntityRendererMap;
  /** Optional post-processing — wraps the full rendered text (e.g. Slack Block Kit JSON) */
  wrapResponse?: (text: string, entities: ParsedEntity[]) => string;
}

// ─── Domain Types ─────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  email: string;
  tier: "standard" | "premium" | "vip";
  since: string;
  totalOrders: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  inStock: boolean;
  rating: number;
}

export interface OrderLineItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  items: OrderLineItem[];
  total: number;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  productCount: number;
  description: string;
}
