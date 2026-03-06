// ─── Dependency Injection Types ──────────────────────────────────────────────
//
// The core pattern: a generic RunContext<T> that carries typed dependencies
// through the agent loop. Tools receive it — the LLM never sees it.
//
// Inspired by PydanticAI's RunContext[Deps] and OpenAI Agents SDK's
// RunContextWrapper[T], adapted for TypeScript.

// ─── Logger Interface ────────────────────────────────────────────────────────

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// ─── Database Interface ─────────────────────────────────────────────────────

export interface Order {
  id: string;
  userId: string;
  items: { name: string; quantity: number; price: number }[];
  total: number;
  status: "pending" | "shipped" | "delivered" | "refunded";
  date: string;
}

export interface Database {
  getOrdersByUser(userId: string): Order[];
  getOrderById(orderId: string): Order | undefined;
  processRefund(orderId: string): { success: boolean; refundId?: string; error?: string };
  getLoyaltyPoints(userId: string): number;
}

// ─── User Info ──────────────────────────────────────────────────────────────

export interface UserInfo {
  id: string;
  name: string;
  tier: "standard" | "premium" | "vip";
}

// ─── The Dependency Container ───────────────────────────────────────────────
//
// Everything tools need but the LLM shouldn't see.
// In a real app, this would hold a Postgres pool, a Redis client,
// an authenticated user from your auth middleware, etc.

export interface Deps {
  db: Database;
  user: UserInfo;
  logger: Logger;
}

// ─── RunContext<T> — The Context Carrier ─────────────────────────────────────
//
// Wraps the dependency container with run-level metadata.
// Passed to every tool execution — never serialized to the LLM.

export interface RunContext<T> {
  deps: T;
  runId: string;
  toolCallCount: number;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createRunContext<T>(deps: T): RunContext<T> {
  return {
    deps,
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolCallCount: 0,
  };
}

// ─── Mock Implementations ───────────────────────────────────────────────────

const MOCK_ORDERS: Order[] = [
  {
    id: "ORD-1001",
    userId: "user-alice",
    items: [
      { name: "Wireless Headphones", quantity: 1, price: 79.99 },
      { name: "USB-C Cable", quantity: 2, price: 12.99 },
    ],
    total: 105.97,
    status: "delivered",
    date: "2026-02-15",
  },
  {
    id: "ORD-1002",
    userId: "user-alice",
    items: [{ name: "Mechanical Keyboard", quantity: 1, price: 149.99 }],
    total: 149.99,
    status: "shipped",
    date: "2026-03-01",
  },
  {
    id: "ORD-1003",
    userId: "user-alice",
    items: [{ name: "Laptop Stand", quantity: 1, price: 45.0 }],
    total: 45.0,
    status: "pending",
    date: "2026-03-05",
  },
  {
    id: "ORD-2001",
    userId: "user-bob",
    items: [
      { name: "Gaming Mouse", quantity: 1, price: 59.99 },
      { name: "Mouse Pad XL", quantity: 1, price: 24.99 },
    ],
    total: 84.98,
    status: "delivered",
    date: "2026-01-20",
  },
  {
    id: "ORD-2002",
    userId: "user-bob",
    items: [{ name: "Monitor Arm", quantity: 1, price: 89.99 }],
    total: 89.99,
    status: "shipped",
    date: "2026-02-28",
  },
];

export function createMockDatabase(): Database {
  const refundedOrders = new Set<string>();

  return {
    getOrdersByUser(userId: string): Order[] {
      return MOCK_ORDERS.filter((o) => o.userId === userId).map((o) =>
        refundedOrders.has(o.id) ? { ...o, status: "refunded" } : o,
      );
    },

    getOrderById(orderId: string): Order | undefined {
      const order = MOCK_ORDERS.find((o) => o.id === orderId);
      if (order && refundedOrders.has(order.id)) {
        return { ...order, status: "refunded" };
      }
      return order;
    },

    processRefund(orderId: string): { success: boolean; refundId?: string; error?: string } {
      const order = MOCK_ORDERS.find((o) => o.id === orderId);
      if (!order) return { success: false, error: "Order not found" };
      if (refundedOrders.has(orderId)) return { success: false, error: "Already refunded" };
      if (order.status === "pending") {
        return { success: false, error: "Cannot refund a pending order" };
      }

      refundedOrders.add(orderId);
      return { success: true, refundId: `REF-${Date.now()}` };
    },

    getLoyaltyPoints(userId: string): number {
      const orders = MOCK_ORDERS.filter((o) => o.userId === userId);
      const basePoints = Math.floor(orders.reduce((sum, o) => sum + o.total, 0));
      return basePoints;
    },
  };
}

// ─── Loyalty Points Multiplier (tier-dependent) ─────────────────────────────

const TIER_MULTIPLIERS: Record<UserInfo["tier"], number> = {
  standard: 1,
  premium: 1.5,
  vip: 3,
};

export function getLoyaltyMultiplier(tier: UserInfo["tier"]): number {
  return TIER_MULTIPLIERS[tier];
}

// ─── Console Logger ─────────────────────────────────────────────────────────

export function createConsoleLogger(prefix: string): Logger {
  return {
    info(message, data) {
      console.log(`  [${prefix}] INFO: ${message}`, data ? JSON.stringify(data) : "");
    },
    warn(message, data) {
      console.log(`  [${prefix}] WARN: ${message}`, data ? JSON.stringify(data) : "");
    },
    error(message, data) {
      console.log(`  [${prefix}] ERROR: ${message}`, data ? JSON.stringify(data) : "");
    },
  };
}

// ─── Recording Logger (for testing) ─────────────────────────────────────────

export interface RecordingLogger extends Logger {
  entries: { level: string; message: string; data?: Record<string, unknown> }[];
}

export function createRecordingLogger(): RecordingLogger {
  const entries: RecordingLogger["entries"] = [];
  return {
    entries,
    info(message, data) {
      entries.push({ level: "info", message, data });
    },
    warn(message, data) {
      entries.push({ level: "warn", message, data });
    },
    error(message, data) {
      entries.push({ level: "error", message, data });
    },
  };
}
