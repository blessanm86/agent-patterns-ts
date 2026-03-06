// ─── Event Sourcing Evals ─────────────────────────────────────────────────────
//
// 4 groups:
//   1. Event log integrity — order lifecycle produces correct event sequence
//   2. Business rule enforcement — rejected intentions are recorded
//   3. Time-travel replay — projectStateAt(N) matches expected snapshot
//   4. State projection determinism — replaying same events always yields same state

import { evalite, createScorer } from "evalite";
import { EventStore, type Item } from "../event-store.js";
import { Orchestrator, type Intention } from "../orchestrator.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freshSetup() {
  const store = new EventStore();
  const orchestrator = new Orchestrator(store);
  return { store, orchestrator };
}

const laptop: Item = { name: "Laptop", price: 999, quantity: 1 };
const mouse: Item = { name: "Mouse", price: 29, quantity: 2 };
const keyboard: Item = { name: "Keyboard", price: 79, quantity: 1 };

// ─── Scorer ───────────────────────────────────────────────────────────────────

const booleanScorer = createScorer<string, boolean>({
  name: "Correct",
  scorer: ({ output, expected }) => (output === expected ? 1 : 0),
});

// ─── 1. Event Log Integrity ──────────────────────────────────────────────────

evalite("Event Sourcing — Event Log Integrity", {
  data: () => [
    {
      input: "Create order, add item, apply discount, confirm, ship",
      expected: true,
    },
    {
      input: "Create order → event count is 1",
      expected: true,
    },
    {
      input: "Full lifecycle → events are ordered by seq",
      expected: true,
    },
  ],
  task: async (input) => {
    const { store, orchestrator } = freshSetup();

    if (input.includes("Full lifecycle")) {
      // Full lifecycle
      orchestrator.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [laptop],
        address: "123 Main St",
      });
      orchestrator.processIntention({
        action: "ADD_ITEM",
        orderId: "ORD-001",
        item: mouse,
      });
      orchestrator.processIntention({
        action: "APPLY_DISCOUNT",
        orderId: "ORD-001",
        code: "SAVE10",
      });
      orchestrator.processIntention({
        action: "CONFIRM_ORDER",
        orderId: "ORD-001",
      });
      orchestrator.processIntention({
        action: "SHIP_ORDER",
        orderId: "ORD-001",
      });

      const events = store.getEvents();
      // Verify monotonic seq ordering
      const seqsOrdered = events.every((e, i) => i === 0 || e.seq > events[i - 1].seq);
      return seqsOrdered;
    }

    if (input.includes("event count is 1")) {
      orchestrator.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [laptop],
        address: "123 Main St",
      });
      return store.length === 1;
    }

    // Default: full lifecycle event type sequence
    orchestrator.processIntention({
      action: "CREATE_ORDER",
      orderId: "ORD-001",
      items: [laptop],
      address: "123 Main St",
    });
    orchestrator.processIntention({
      action: "ADD_ITEM",
      orderId: "ORD-001",
      item: mouse,
    });
    orchestrator.processIntention({
      action: "APPLY_DISCOUNT",
      orderId: "ORD-001",
      code: "SAVE10",
    });
    orchestrator.processIntention({
      action: "CONFIRM_ORDER",
      orderId: "ORD-001",
    });
    orchestrator.processIntention({
      action: "SHIP_ORDER",
      orderId: "ORD-001",
    });

    const types = store.getEvents().map((e) => e.event.type);
    const expected = [
      "ORDER_CREATED",
      "ITEM_ADDED",
      "DISCOUNT_APPLIED",
      "ORDER_CONFIRMED",
      "ORDER_SHIPPED",
    ];
    return JSON.stringify(types) === JSON.stringify(expected);
  },
  scorers: [booleanScorer],
});

// ─── 2. Business Rule Enforcement ────────────────────────────────────────────

evalite("Event Sourcing — Business Rule Enforcement", {
  data: () => [
    {
      input: "Change address after shipping → rejected",
      expected: true,
    },
    {
      input: "Add item after confirmation → rejected",
      expected: true,
    },
    {
      input: "Apply unknown discount code → rejected",
      expected: true,
    },
    {
      input: "Confirm empty order → rejected",
      expected: true,
    },
    {
      input: "Ship unconfirmed order → rejected",
      expected: true,
    },
    {
      input: "Duplicate discount code → rejected",
      expected: true,
    },
  ],
  task: async (input) => {
    const { orchestrator } = freshSetup();

    // Set up a shipped order for address-change test
    if (input.includes("address after shipping")) {
      orchestrator.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [laptop],
        address: "123 Main St",
      });
      orchestrator.processIntention({ action: "CONFIRM_ORDER", orderId: "ORD-001" });
      orchestrator.processIntention({ action: "SHIP_ORDER", orderId: "ORD-001" });

      const result = orchestrator.processIntention({
        action: "CHANGE_ADDRESS",
        orderId: "ORD-001",
        newAddress: "456 Oak Ave",
      });
      return !result.accepted && result.event.type === "INTENTION_REJECTED";
    }

    if (input.includes("item after confirmation")) {
      orchestrator.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [laptop],
        address: "123 Main St",
      });
      orchestrator.processIntention({ action: "CONFIRM_ORDER", orderId: "ORD-001" });

      const result = orchestrator.processIntention({
        action: "ADD_ITEM",
        orderId: "ORD-001",
        item: keyboard,
      });
      return !result.accepted;
    }

    if (input.includes("unknown discount")) {
      orchestrator.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [laptop],
        address: "123 Main St",
      });
      const result = orchestrator.processIntention({
        action: "APPLY_DISCOUNT",
        orderId: "ORD-001",
        code: "FAKECODE",
      });
      return !result.accepted;
    }

    if (input.includes("empty order")) {
      // Can't create an empty order — the creation itself is rejected
      const result = orchestrator.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [],
        address: "123 Main St",
      });
      return !result.accepted;
    }

    if (input.includes("Ship unconfirmed")) {
      orchestrator.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [laptop],
        address: "123 Main St",
      });
      const result = orchestrator.processIntention({
        action: "SHIP_ORDER",
        orderId: "ORD-001",
      });
      return !result.accepted;
    }

    if (input.includes("Duplicate discount")) {
      orchestrator.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [laptop],
        address: "123 Main St",
      });
      orchestrator.processIntention({
        action: "APPLY_DISCOUNT",
        orderId: "ORD-001",
        code: "SAVE10",
      });
      const result = orchestrator.processIntention({
        action: "APPLY_DISCOUNT",
        orderId: "ORD-001",
        code: "SAVE10",
      });
      return !result.accepted;
    }

    return false;
  },
  scorers: [booleanScorer],
});

// ─── 3. Time-Travel Replay ───────────────────────────────────────────────────

evalite("Event Sourcing — Time-Travel Replay", {
  data: () => [
    {
      input: "State at seq 1 has order in created status",
      expected: true,
    },
    {
      input: "State at seq 3 has discount applied",
      expected: true,
    },
    {
      input: "State at seq 5 has order shipped",
      expected: true,
    },
    {
      input: "Replay to seq 2 doesn't include later events",
      expected: true,
    },
  ],
  task: async (input) => {
    const { store, orchestrator } = freshSetup();

    // Build a 5-event sequence
    orchestrator.processIntention({
      action: "CREATE_ORDER",
      orderId: "ORD-001",
      items: [laptop, mouse],
      address: "123 Main St",
    }); // seq 1
    orchestrator.processIntention({
      action: "CHANGE_ADDRESS",
      orderId: "ORD-001",
      newAddress: "456 Oak Ave",
    }); // seq 2
    orchestrator.processIntention({
      action: "APPLY_DISCOUNT",
      orderId: "ORD-001",
      code: "SAVE10",
    }); // seq 3
    orchestrator.processIntention({
      action: "CONFIRM_ORDER",
      orderId: "ORD-001",
    }); // seq 4
    orchestrator.processIntention({
      action: "SHIP_ORDER",
      orderId: "ORD-001",
    }); // seq 5

    if (input.includes("seq 1")) {
      const state = store.projectStateAt(1);
      const order = state.orders.get("ORD-001");
      return order?.status === "created" && order?.address === "123 Main St";
    }

    if (input.includes("seq 3")) {
      const state = store.projectStateAt(3);
      const order = state.orders.get("ORD-001");
      return (order?.discounts.length ?? 0) > 0 && order?.status === "created";
    }

    if (input.includes("seq 5")) {
      const state = store.projectStateAt(5);
      const order = state.orders.get("ORD-001");
      return order?.status === "shipped";
    }

    if (input.includes("doesn't include later")) {
      const state = store.projectStateAt(2);
      const order = state.orders.get("ORD-001");
      // At seq 2 the address should be changed but no discount yet
      return (
        order?.address === "456 Oak Ave" &&
        order?.discounts.length === 0 &&
        order?.status === "created"
      );
    }

    return false;
  },
  scorers: [booleanScorer],
});

// ─── 4. State Projection Determinism ─────────────────────────────────────────

evalite("Event Sourcing — Projection Determinism", {
  data: () => [
    {
      input: "Same events replayed twice yield identical state",
      expected: true,
    },
    {
      input: "projectState equals projectStateAt(last seq)",
      expected: true,
    },
    {
      input: "Discount math is correct after replay",
      expected: true,
    },
  ],
  task: async (input) => {
    if (input.includes("replayed twice")) {
      const store1 = new EventStore();
      const orch1 = new Orchestrator(store1);
      const store2 = new EventStore();
      const orch2 = new Orchestrator(store2);

      const intentions: Intention[] = [
        {
          action: "CREATE_ORDER",
          orderId: "ORD-001",
          items: [laptop, mouse],
          address: "123 Main St",
        },
        { action: "APPLY_DISCOUNT", orderId: "ORD-001", code: "SAVE20" },
        { action: "CONFIRM_ORDER", orderId: "ORD-001" },
      ];

      for (const i of intentions) {
        orch1.processIntention(i);
        orch2.processIntention(i);
      }

      const s1 = store1.projectState();
      const s2 = store2.projectState();
      const o1 = s1.orders.get("ORD-001");
      const o2 = s2.orders.get("ORD-001");

      return (
        o1?.totalAfterDiscount === o2?.totalAfterDiscount &&
        o1?.status === o2?.status &&
        o1?.items.length === o2?.items.length
      );
    }

    if (input.includes("projectStateAt(last seq)")) {
      const store = new EventStore();
      const orch = new Orchestrator(store);

      orch.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [laptop],
        address: "123 Main St",
      });
      orch.processIntention({ action: "CONFIRM_ORDER", orderId: "ORD-001" });

      const full = store.projectState();
      const atLast = store.projectStateAt(store.length);
      const o1 = full.orders.get("ORD-001");
      const o2 = atLast.orders.get("ORD-001");

      return o1?.status === o2?.status && o1?.totalAfterDiscount === o2?.totalAfterDiscount;
    }

    if (input.includes("Discount math")) {
      const store = new EventStore();
      const orch = new Orchestrator(store);

      orch.processIntention({
        action: "CREATE_ORDER",
        orderId: "ORD-001",
        items: [{ name: "Widget", price: 100, quantity: 1 }],
        address: "123 Main St",
      });
      orch.processIntention({ action: "APPLY_DISCOUNT", orderId: "ORD-001", code: "SAVE20" });

      const state = store.projectState();
      const order = state.orders.get("ORD-001");
      // 100 * (1 - 0.20) = 80
      return order?.totalBeforeDiscount === 100 && order?.totalAfterDiscount === 80;
    }

    return false;
  },
  scorers: [booleanScorer],
});
