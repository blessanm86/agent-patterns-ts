// ─── Ambient Context Types ───────────────────────────────────────────────────

export type ContextType =
  | "product"
  | "cart"
  | "category"
  | "order"
  | "user"
  | "time-range"
  | "filter";

export interface AmbientContext {
  id: string; // unique key: `${type}:${identifier}`
  type: ContextType;
  data: Record<string, string>; // serializable key-value pairs
  refCount: number; // mount/unmount lifecycle tracking
  excluded: boolean; // user toggled off
  temporary: boolean; // restored from persistence, not yet reclaimed
  source: string; // which page registered this
}

// ─── Page Types ──────────────────────────────────────────────────────────────

export type PageName = "catalog" | "product" | "cart" | "orders" | "account";

export interface Page {
  name: PageName;
  title: string;
  register: (store: ContextStore, args?: string) => void;
  unregister: (store: ContextStore, args?: string) => void;
  display: (args?: string) => string;
}

// ─── Store Interface ─────────────────────────────────────────────────────────
// Forward-declared so pages.ts and context-store.ts don't circularly depend.

export interface ContextStore {
  register(
    type: ContextType,
    identifier: string,
    data: Record<string, string>,
    source: string,
  ): void;
  unregister(type: ContextType, identifier: string, source: string): void;
  exclude(contextId: string): boolean;
  include(contextId: string): boolean;
  getActive(): AmbientContext[];
  getAll(): AmbientContext[];
  serialize(): string;
  persist(filePath: string): void;
  restore(filePath: string): number;
  getDisplayChips(): string[];
  getStats(): ContextStats;
}

export interface ContextStats {
  total: number;
  active: number;
  excluded: number;
  temporary: number;
}

// ─── Product / Order / Cart Types ────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string;
  inStock: boolean;
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  date: string;
  items: { name: string; quantity: number; price: number }[];
  total: number;
  status: string;
}

export interface UserProfile {
  name: string;
  email: string;
  tier: string;
  memberSince: string;
}
