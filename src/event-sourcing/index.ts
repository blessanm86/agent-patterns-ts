// ─── Event Sourcing Demo — E-Commerce Order Management ───────────────────────
//
// Slash commands expose the event sourcing internals:
//   /events          — dump the full append-only event log
//   /replay <N>      — time-travel: show state after event N
//   /state           — show current projected state (all orders)
//   /state <orderId> — show projected state for one order

import { runAgent } from "./agent.js";
import { eventStore } from "./tools.js";
import { createCLI } from "../shared/cli.js";
import type { StoredEvent, OrderState, ProjectedState } from "./event-store.js";

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function formatEvent(e: StoredEvent): string {
  const ts = e.timestamp.split("T")[1]?.split(".")[0] ?? e.timestamp;
  const { event } = e;

  switch (event.type) {
    case "ORDER_CREATED":
      return `  #${e.seq} [${ts}] ORDER_CREATED — ${event.payload.orderId} (${event.payload.items.length} items → ${event.payload.address})`;
    case "ADDRESS_CHANGED":
      return `  #${e.seq} [${ts}] ADDRESS_CHANGED — ${event.payload.orderId} → ${event.payload.newAddress}`;
    case "ITEM_ADDED":
      return `  #${e.seq} [${ts}] ITEM_ADDED — ${event.payload.orderId} + ${event.payload.item.name} x${event.payload.item.quantity}`;
    case "DISCOUNT_APPLIED":
      return `  #${e.seq} [${ts}] DISCOUNT_APPLIED — ${event.payload.orderId} (${event.payload.code} ${event.payload.percent}%)`;
    case "ORDER_CONFIRMED":
      return `  #${e.seq} [${ts}] ORDER_CONFIRMED — ${event.payload.orderId}`;
    case "ORDER_SHIPPED":
      return `  #${e.seq} [${ts}] ORDER_SHIPPED — ${event.payload.orderId}`;
    case "INTENTION_REJECTED":
      return `  #${e.seq} [${ts}] REJECTED — ${event.payload.orderId} tried ${event.payload.attemptedAction}: ${event.payload.reason}`;
  }
}

function formatOrderState(order: OrderState): string {
  const lines = [
    `  ${order.orderId} [${order.status}]`,
    `    Address: ${order.address}`,
    ...order.items.map((i) => `    - ${i.name} x${i.quantity} @ $${i.price}`),
  ];
  if (order.discounts.length > 0) {
    lines.push(
      `    Discounts: ${order.discounts.map((d) => `${d.code} (${d.percent}%)`).join(", ")}`,
    );
  }
  lines.push(`    Total: $${order.totalAfterDiscount}`);
  return lines.join("\n");
}

function formatProjectedState(state: ProjectedState, label: string): void {
  console.log(`\n  📋 ${label}`);
  if (state.orders.size === 0) {
    console.log("  (no orders)");
    return;
  }
  for (const order of state.orders.values()) {
    console.log(formatOrderState(order));
  }
  if (state.rejections.length > 0) {
    console.log(`\n  ❌ Rejections: ${state.rejections.length}`);
    for (const r of state.rejections) {
      console.log(`    #${r.seq} ${r.orderId} — ${r.action}: ${r.reason}`);
    }
  }
}

// ─── Slash Command Handler ───────────────────────────────────────────────────

function handleCommand(command: string): boolean {
  const parts = command.split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case "/events": {
      const events = eventStore.getEvents();
      if (events.length === 0) {
        console.log("\n  📜 Event log is empty — no events recorded yet.");
      } else {
        console.log(`\n  📜 Event Log (${events.length} events):`);
        for (const e of events) {
          console.log(formatEvent(e));
        }
      }
      return true;
    }

    case "/replay": {
      const seq = Number.parseInt(parts[1] ?? "", 10);
      if (Number.isNaN(seq) || seq < 1) {
        console.log("\n  Usage: /replay <N> — replay events up to sequence N");
        console.log(`  Current log has ${eventStore.length} events (1–${eventStore.length})`);
        return true;
      }
      if (seq > eventStore.length) {
        console.log(`\n  ⚠️  Only ${eventStore.length} events exist. Replaying all.`);
      }
      const events = eventStore.getEventsUpTo(seq);
      console.log(`\n  ⏪ Time-travel replay: events 1–${seq}`);
      for (const e of events) {
        console.log(formatEvent(e));
      }
      const state = eventStore.projectStateAt(seq);
      formatProjectedState(state, `State after event #${seq}:`);
      return true;
    }

    case "/state": {
      const orderId = parts[1];
      const state = eventStore.projectState();
      if (orderId) {
        const order = state.orders.get(orderId);
        if (!order) {
          console.log(`\n  ⚠️  Order ${orderId} not found`);
        } else {
          console.log(`\n  📋 Current state:`);
          console.log(formatOrderState(order));
        }
      } else {
        formatProjectedState(state, "Current projected state:");
      }
      return true;
    }

    default:
      return false;
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

createCLI({
  title: "Event Sourcing Demo — E-Commerce Orders",
  emoji: "📜",
  goodbye: "Goodbye! 📜",
  dividerWidth: 60,
  welcomeLines: [
    "💡  The agent emits intention events; an orchestrator validates",
    "    them against business rules before they enter the event log.",
    "",
    "    Slash commands to inspect the event-sourcing internals:",
    "      /events          — view the full append-only event log",
    "      /replay <N>      — time-travel: state after event N",
    "      /state           — current projected state",
    "",
    '    Try: "Create an order for a Laptop ($999) and a Mouse ($29),',
    '          ship to 123 Main St"',
    '    Then: "Apply discount code SAVE10"',
    '    Then: "Confirm and ship the order"',
    '    Then: "Change the shipping address to 456 Oak Ave"',
    "          (should be rejected — already shipped!)",
  ],
  async onMessage(input, history) {
    const messages = await runAgent(input, history);
    return {
      messages,
      stats: [`\n  📊 Event log: ${eventStore.length} events`],
    };
  },
  onCommand(command) {
    return handleCommand(command);
  },
}).start();
