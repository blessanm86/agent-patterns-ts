// ─── Pattern 5: Multi-Turn Consistency Evals ─────────────────────────────────
//
// Multi-turn evals test that the agent correctly remembers context across turns.
// A single-turn eval can't catch these bugs:
//   - Guest name provided in Turn 1 is forgotten by Turn 3
//   - Dates from Turn 2 get dropped when booking is requested in Turn 4
//   - Agent contradicts itself between turns
//
// The technique: run several turns sequentially, passing history through.
// Then assert that data from early turns survives in late tool calls.
//
// evalite note: the `data` function returns a sentinel input (a test name
// string). The `task` ignores it and runs the full turn sequence internally.
// This is the standard pattern for multi-turn evals in evalite because each
// "row" must have a single input value.

import { evalite, createScorer } from "evalite";
import { runHotelAgent } from "../agent.js";
import { extractToolCalls } from "../../react/eval-utils.js";
import { createMockExecutor } from "../fixtures/mock-tools.js";
import type { Message, ToolCall } from "../../shared/types.js";

// ─── Helper: run N turns sequentially ────────────────────────────────────────

async function runTurns(
  turns: string[],
  executor: (name: string, args: Record<string, string>) => string,
): Promise<Message[]> {
  let history: Message[] = [];
  for (const turn of turns) {
    history = await runHotelAgent(turn, history, { executorFn: executor });
  }
  return history;
}

// ─── Test 1: Guest name preserved across turns ────────────────────────────────
//
// Turn 1: introduce name only
// Turn 2: add room type preference
// Turn 3: add dates + request booking
//
// The name from Turn 1 must appear in the create_reservation arguments.
// If the agent loses it, the reservation will have a wrong or missing guest name.

evalite("Multi-turn — guest name preserved across turns", {
  data: async () => [{ input: "name-memory-test" }],
  task: async () => {
    const executor = createMockExecutor({
      check_availability: () =>
        JSON.stringify({
          available: true,
          nights: 3,
          rooms: [{ type: "double", pricePerNight: 180, totalPrice: 540 }],
        }),
      create_reservation: (args) =>
        JSON.stringify({
          success: true,
          reservation: {
            reservationId: "RES-MULTI-001",
            guestName: args.guest_name,
            roomType: args.room_type,
            checkIn: args.check_in,
            checkOut: args.check_out,
          },
        }),
    });

    const history = await runTurns(
      [
        "My name is Grace Hopper.",
        "I'd like to book a double room.",
        "Check in July 10th, check out July 13th, 2026. Please go ahead and book it.",
      ],
      executor,
    );

    return extractToolCalls(history);
  },
  scorers: [
    createScorer<string, ToolCall[]>({
      name: "Guest name in reservation",
      scorer: ({ output }) => {
        const call = output.find((tc: ToolCall) => tc.function.name === "create_reservation");
        if (!call) return 0;
        const name = (call.function.arguments.guest_name ?? "").toLowerCase();
        return name.includes("grace") || name.includes("hopper") ? 1 : 0;
      },
    }),
    createScorer<string, ToolCall[]>({
      name: "Reservation was created",
      scorer: ({ output }) =>
        output.some((tc: ToolCall) => tc.function.name === "create_reservation") ? 1 : 0,
    }),
  ],
});

// ─── Test 2: Dates preserved across turns ────────────────────────────────────
//
// Turn 1: mention dates only
// Turn 2: provide name
// Turn 3: select room type and confirm
//
// The dates from Turn 1 must survive to the create_reservation call in Turn 3.

evalite("Multi-turn — dates preserved across turns", {
  data: async () => [{ input: "date-memory-test" }],
  task: async () => {
    const executor = createMockExecutor({
      check_availability: () =>
        JSON.stringify({
          available: true,
          nights: 4,
          rooms: [{ type: "single", pricePerNight: 120, totalPrice: 480 }],
        }),
      create_reservation: (args) =>
        JSON.stringify({
          success: true,
          reservation: {
            reservationId: "RES-MULTI-002",
            guestName: args.guest_name ?? "Henry Adams",
            roomType: args.room_type,
            checkIn: args.check_in,
            checkOut: args.check_out,
          },
        }),
    });

    const history = await runTurns(
      [
        "I need a room from August 5th to August 9th, 2026.",
        "My name is Henry Adams.",
        "A single room please. Go ahead and book it.",
      ],
      executor,
    );

    return extractToolCalls(history);
  },
  scorers: [
    createScorer<string, ToolCall[]>({
      name: "Check-in date preserved",
      scorer: ({ output }) => {
        const call = output.find((tc: ToolCall) => tc.function.name === "create_reservation");
        if (!call) return 0;
        return call.function.arguments.check_in === "2026-08-05" ? 1 : 0;
      },
    }),
    createScorer<string, ToolCall[]>({
      name: "Check-out date preserved",
      scorer: ({ output }) => {
        const call = output.find((tc: ToolCall) => tc.function.name === "create_reservation");
        if (!call) return 0;
        return call.function.arguments.check_out === "2026-08-09" ? 1 : 0;
      },
    }),
  ],
});
