// ─── Deterministic Orchestrator ──────────────────────────────────────────────
//
// The orchestrator sits between the agent and the event store.
// When the agent wants to do something, it emits an "intention" — a structured
// JSON object describing what it wants. The orchestrator:
//
//   1. Validates the intention against business rules
//   2. If valid → converts to an event and appends to the store
//   3. If invalid → appends an INTENTION_REJECTED event (the rejection itself is recorded)
//
// The agent never mutates state directly. Every state change — including
// rejections — flows through this single gateway.

import {
  EventStore,
  type OrderEvent,
  type OrderState,
  type ProjectedState,
} from "./event-store.js";

// ─── Intention Types ─────────────────────────────────────────────────────────
//
// These mirror the event types but represent what the agent *wants* to do,
// not what *happened*. The orchestrator decides whether to allow it.

export type Intention =
  | {
      action: "CREATE_ORDER";
      orderId: string;
      items: { name: string; price: number; quantity: number }[];
      address: string;
    }
  | { action: "CHANGE_ADDRESS"; orderId: string; newAddress: string }
  | { action: "ADD_ITEM"; orderId: string; item: { name: string; price: number; quantity: number } }
  | { action: "APPLY_DISCOUNT"; orderId: string; code: string }
  | { action: "CONFIRM_ORDER"; orderId: string }
  | { action: "SHIP_ORDER"; orderId: string };

// ─── Known Discount Codes ────────────────────────────────────────────────────

const DISCOUNT_CODES: Record<string, number> = {
  SAVE10: 10,
  SAVE20: 20,
  VIP25: 25,
  WELCOME15: 15,
};

// ─── Validation Result ───────────────────────────────────────────────────────

type ValidationResult = { valid: true; event: OrderEvent } | { valid: false; reason: string };

// ─── Business Rule Validation ────────────────────────────────────────────────

function validateIntention(intention: Intention, state: ProjectedState): ValidationResult {
  switch (intention.action) {
    case "CREATE_ORDER": {
      if (state.orders.has(intention.orderId)) {
        return { valid: false, reason: `Order ${intention.orderId} already exists` };
      }
      if (intention.items.length === 0) {
        return { valid: false, reason: "Cannot create an order with no items" };
      }
      return {
        valid: true,
        event: {
          type: "ORDER_CREATED",
          payload: {
            orderId: intention.orderId,
            items: intention.items,
            address: intention.address,
          },
        },
      };
    }

    case "CHANGE_ADDRESS": {
      const order = state.orders.get(intention.orderId);
      if (!order) {
        return { valid: false, reason: `Order ${intention.orderId} not found` };
      }
      if (order.status === "shipped") {
        return {
          valid: false,
          reason: "Cannot change address — order has already shipped",
        };
      }
      return {
        valid: true,
        event: {
          type: "ADDRESS_CHANGED",
          payload: { orderId: intention.orderId, newAddress: intention.newAddress },
        },
      };
    }

    case "ADD_ITEM": {
      const order = state.orders.get(intention.orderId);
      if (!order) {
        return { valid: false, reason: `Order ${intention.orderId} not found` };
      }
      if (order.status === "confirmed" || order.status === "shipped") {
        return {
          valid: false,
          reason: `Cannot add items — order is already ${order.status}`,
        };
      }
      return {
        valid: true,
        event: {
          type: "ITEM_ADDED",
          payload: { orderId: intention.orderId, item: intention.item },
        },
      };
    }

    case "APPLY_DISCOUNT": {
      const order = state.orders.get(intention.orderId);
      if (!order) {
        return { valid: false, reason: `Order ${intention.orderId} not found` };
      }
      if (order.status === "confirmed" || order.status === "shipped") {
        return {
          valid: false,
          reason: `Cannot apply discount — order is already ${order.status}`,
        };
      }
      const percent = DISCOUNT_CODES[intention.code.toUpperCase()];
      if (percent === undefined) {
        return {
          valid: false,
          reason: `Unknown discount code: "${intention.code}"`,
        };
      }
      if (order.discounts.some((d) => d.code === intention.code.toUpperCase())) {
        return {
          valid: false,
          reason: `Discount code "${intention.code}" has already been applied`,
        };
      }
      return {
        valid: true,
        event: {
          type: "DISCOUNT_APPLIED",
          payload: {
            orderId: intention.orderId,
            code: intention.code.toUpperCase(),
            percent,
          },
        },
      };
    }

    case "CONFIRM_ORDER": {
      const order = state.orders.get(intention.orderId);
      if (!order) {
        return { valid: false, reason: `Order ${intention.orderId} not found` };
      }
      if (order.status !== "created") {
        return {
          valid: false,
          reason: `Cannot confirm — order is already ${order.status}`,
        };
      }
      if (order.items.length === 0) {
        return { valid: false, reason: "Cannot confirm an order with no items" };
      }
      return {
        valid: true,
        event: { type: "ORDER_CONFIRMED", payload: { orderId: intention.orderId } },
      };
    }

    case "SHIP_ORDER": {
      const order = state.orders.get(intention.orderId);
      if (!order) {
        return { valid: false, reason: `Order ${intention.orderId} not found` };
      }
      if (order.status !== "confirmed") {
        return {
          valid: false,
          reason:
            order.status === "shipped"
              ? "Order has already shipped"
              : "Cannot ship — order has not been confirmed yet",
        };
      }
      return {
        valid: true,
        event: { type: "ORDER_SHIPPED", payload: { orderId: intention.orderId } },
      };
    }
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface IntentionResult {
  accepted: boolean;
  event: OrderEvent;
  seq: number;
  order?: OrderState;
}

export class Orchestrator {
  constructor(private store: EventStore) {}

  /** Process an agent intention: validate → append event (or rejection) → return result. */
  processIntention(intention: Intention): IntentionResult {
    const currentState = this.store.projectState();
    const result = validateIntention(intention, currentState);

    if (result.valid) {
      const stored = this.store.append(result.event);
      const newState = this.store.projectState();
      const orderId = "orderId" in intention ? intention.orderId : "";
      return {
        accepted: true,
        event: result.event,
        seq: stored.seq,
        order: newState.orders.get(orderId),
      };
    }

    // Rejection is itself an event — it goes into the log
    const orderId = "orderId" in intention ? intention.orderId : "unknown";
    const rejectionEvent: OrderEvent = {
      type: "INTENTION_REJECTED",
      payload: {
        orderId,
        attemptedAction: intention.action,
        reason: result.reason,
      },
    };
    const stored = this.store.append(rejectionEvent);
    return {
      accepted: false,
      event: rejectionEvent,
      seq: stored.seq,
    };
  }
}
