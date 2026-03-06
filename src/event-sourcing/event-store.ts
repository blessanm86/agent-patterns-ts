// ─── Event Sourcing Store ────────────────────────────────────────────────────
//
// Append-only event log with deterministic state projection.
// The event store is the source of truth — current state is always derived
// by replaying events from the log, never stored directly.

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface Item {
  name: string;
  price: number;
  quantity: number;
}

export type OrderStatus = "created" | "confirmed" | "shipped";

// ─── Event Types ─────────────────────────────────────────────────────────────
//
// Each event represents something that *happened* — past tense, immutable.
// The agent never mutates state directly; it emits intentions that the
// orchestrator validates and converts into these events.

export type OrderEvent =
  | { type: "ORDER_CREATED"; payload: { orderId: string; items: Item[]; address: string } }
  | { type: "ADDRESS_CHANGED"; payload: { orderId: string; newAddress: string } }
  | { type: "ITEM_ADDED"; payload: { orderId: string; item: Item } }
  | { type: "DISCOUNT_APPLIED"; payload: { orderId: string; code: string; percent: number } }
  | { type: "ORDER_CONFIRMED"; payload: { orderId: string } }
  | { type: "ORDER_SHIPPED"; payload: { orderId: string } }
  | {
      type: "INTENTION_REJECTED";
      payload: { orderId: string; attemptedAction: string; reason: string };
    };

// ─── Stored Event (event + metadata) ─────────────────────────────────────────

export interface StoredEvent {
  seq: number;
  timestamp: string;
  event: OrderEvent;
}

// ─── Projected State ─────────────────────────────────────────────────────────

export interface OrderState {
  orderId: string;
  items: Item[];
  address: string;
  status: OrderStatus;
  discounts: Array<{ code: string; percent: number }>;
  totalBeforeDiscount: number;
  totalAfterDiscount: number;
}

export interface ProjectedState {
  orders: Map<string, OrderState>;
  rejections: Array<{ seq: number; orderId: string; action: string; reason: string }>;
}

// ─── State Reducer ───────────────────────────────────────────────────────────
//
// Pure function: takes current state + one event, returns new state.
// This is the only place state transitions are defined.

function computeTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function applyDiscounts(total: number, discounts: Array<{ percent: number }>): number {
  let result = total;
  for (const d of discounts) {
    result = result * (1 - d.percent / 100);
  }
  return Math.round(result * 100) / 100;
}

function applyEvent(state: ProjectedState, stored: StoredEvent): ProjectedState {
  const { event } = stored;

  switch (event.type) {
    case "ORDER_CREATED": {
      const total = computeTotal(event.payload.items);
      const order: OrderState = {
        orderId: event.payload.orderId,
        items: [...event.payload.items],
        address: event.payload.address,
        status: "created",
        discounts: [],
        totalBeforeDiscount: total,
        totalAfterDiscount: total,
      };
      const orders = new Map(state.orders);
      orders.set(order.orderId, order);
      return { ...state, orders };
    }

    case "ADDRESS_CHANGED": {
      const orders = new Map(state.orders);
      const existing = orders.get(event.payload.orderId);
      if (!existing) return state;
      orders.set(existing.orderId, { ...existing, address: event.payload.newAddress });
      return { ...state, orders };
    }

    case "ITEM_ADDED": {
      const orders = new Map(state.orders);
      const existing = orders.get(event.payload.orderId);
      if (!existing) return state;
      const items = [...existing.items, event.payload.item];
      const total = computeTotal(items);
      orders.set(existing.orderId, {
        ...existing,
        items,
        totalBeforeDiscount: total,
        totalAfterDiscount: applyDiscounts(total, existing.discounts),
      });
      return { ...state, orders };
    }

    case "DISCOUNT_APPLIED": {
      const orders = new Map(state.orders);
      const existing = orders.get(event.payload.orderId);
      if (!existing) return state;
      const discounts = [
        ...existing.discounts,
        { code: event.payload.code, percent: event.payload.percent },
      ];
      orders.set(existing.orderId, {
        ...existing,
        discounts,
        totalAfterDiscount: applyDiscounts(existing.totalBeforeDiscount, discounts),
      });
      return { ...state, orders };
    }

    case "ORDER_CONFIRMED": {
      const orders = new Map(state.orders);
      const existing = orders.get(event.payload.orderId);
      if (!existing) return state;
      orders.set(existing.orderId, { ...existing, status: "confirmed" });
      return { ...state, orders };
    }

    case "ORDER_SHIPPED": {
      const orders = new Map(state.orders);
      const existing = orders.get(event.payload.orderId);
      if (!existing) return state;
      orders.set(existing.orderId, { ...existing, status: "shipped" });
      return { ...state, orders };
    }

    case "INTENTION_REJECTED": {
      return {
        ...state,
        rejections: [
          ...state.rejections,
          {
            seq: stored.seq,
            orderId: event.payload.orderId,
            action: event.payload.attemptedAction,
            reason: event.payload.reason,
          },
        ],
      };
    }
  }
}

// ─── Event Store ─────────────────────────────────────────────────────────────

function emptyState(): ProjectedState {
  return { orders: new Map(), rejections: [] };
}

export class EventStore {
  private log: StoredEvent[] = [];
  private nextSeq = 1;

  /** Append an event to the immutable log. Returns the stored event with metadata. */
  append(event: OrderEvent): StoredEvent {
    const stored: StoredEvent = {
      seq: this.nextSeq++,
      timestamp: new Date().toISOString(),
      event,
    };
    this.log.push(stored);
    return stored;
  }

  /** Return a copy of the full event log. */
  getEvents(): StoredEvent[] {
    return [...this.log];
  }

  /** Return events up to (and including) the given sequence number. */
  getEventsUpTo(seq: number): StoredEvent[] {
    return this.log.filter((e) => e.seq <= seq);
  }

  /** Replay all events to produce current state. */
  projectState(): ProjectedState {
    return this.log.reduce(applyEvent, emptyState());
  }

  /** Replay events up to seq N — time-travel to a past state. */
  projectStateAt(seq: number): ProjectedState {
    return this.getEventsUpTo(seq).reduce(applyEvent, emptyState());
  }

  /** How many events are in the log. */
  get length(): number {
    return this.log.length;
  }
}
