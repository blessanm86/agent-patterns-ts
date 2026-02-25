// ─── Pattern 1: Trajectory Evals with Mocked Tools ────────────────────────────
//
// Trajectory evals check WHICH tools were called and IN WHAT ORDER.
// This is the cheapest, fastest eval — no LLM judge, no slow assertions.
// If the trajectory is wrong, the final answer will be wrong regardless
// of how good the model sounds.
//
// KEY UPGRADE over plain trajectory evals: mocked tools.
// The agent sees real tool schemas (so it reasons correctly) but gets
// controlled responses. Each test is isolated — no shared state.
//
// Without mocks: tests depend on MOCK_ROOMS state in src/react/tools.ts.
//   create_reservation mutates MOCK_ROOMS in-place. Run order matters.
//   Tests can leave the room array in unexpected states.
//
// With mocks: each test controls exactly what tools return.
//   No side effects. Parallelizable. Deterministic.

import { evalite, createScorer } from "evalite";
import { runHotelAgent } from "../agent.js";
import { extractToolCallNames, extractToolCalls } from "../../react/eval-utils.js";
import { createMockExecutor, scenarios } from "../fixtures/mock-tools.js";
import type { ToolCall } from "../../shared/types.js";

// ─── Test 1: Full Booking Trajectory ──────────────────────────────────────────
//
// A full booking requires three tools in this order:
//   check_availability → get_room_price → create_reservation
//
// Mock: onlySuiteAvailable — agent finds rooms and proceeds to book.
// The mocked create_reservation returns a success without touching MOCK_ROOMS.

evalite("Trajectory — happy path (mocked tools)", {
  data: async () => [
    { input: "My name is John Smith. Book a double room from 2026-03-01 to 2026-03-05." },
  ],
  task: async (input) => {
    const executor = createMockExecutor({
      ...scenarios.onlySuiteAvailable,
      create_reservation: (args) =>
        JSON.stringify({
          success: true,
          reservation: {
            reservationId: "RES-TRAJ-001",
            guestName: args.guest_name,
            roomType: args.room_type,
            checkIn: args.check_in,
            checkOut: args.check_out,
          },
        }),
    });
    const history = await runHotelAgent(input, [], { executorFn: executor });
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "All tools called",
      scorer: ({ output }) =>
        ["check_availability", "get_room_price", "create_reservation"].every((t) =>
          output.includes(t),
        )
          ? 1
          : 0,
    }),
    createScorer<string, string[]>({
      name: "Correct order",
      scorer: ({ output }) => {
        const i1 = output.indexOf("check_availability");
        const i2 = output.indexOf("get_room_price");
        const i3 = output.indexOf("create_reservation");
        return i1 !== -1 && i2 !== -1 && i3 !== -1 && i1 < i2 && i2 < i3 ? 1 : 0;
      },
    }),
  ],
});

// ─── Test 2: Browse Only ──────────────────────────────────────────────────────
//
// When the user is just browsing, the agent should check availability
// but NOT proceed to booking. Tests that the agent respects user intent.

evalite("Trajectory — browse only, no booking", {
  data: async () => [
    {
      input:
        "What rooms are available from 2026-04-10 to 2026-04-12? Just looking, not booking yet.",
    },
  ],
  task: async (input) => {
    const executor = createMockExecutor(scenarios.onlySuiteAvailable);
    const history = await runHotelAgent(input, [], { executorFn: executor });
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "Availability was checked",
      scorer: ({ output }) => (output.includes("check_availability") ? 1 : 0),
    }),
    createScorer<string, string[]>({
      name: "No reservation created",
      scorer: ({ output }) => (output.includes("create_reservation") ? 0 : 1),
    }),
  ],
});

// ─── Test 3: Argument Fidelity ─────────────────────────────────────────────────
//
// Tool trajectories alone aren't enough — we also verify the agent passes
// the CORRECT VALUES through the chain. A guest name or date that gets
// garbled is a real bug even if all tools were called.

evalite("Trajectory — argument fidelity (guest name + dates)", {
  data: async () => [{ input: "I'm Alice Johnson. I need a suite from 2026-05-10 to 2026-05-15." }],
  task: async (input) => {
    const executor = createMockExecutor({
      ...scenarios.onlySuiteAvailable,
      create_reservation: (args) =>
        JSON.stringify({
          success: true,
          reservation: {
            reservationId: "RES-TRAJ-002",
            guestName: args.guest_name,
            roomType: args.room_type,
            checkIn: args.check_in,
            checkOut: args.check_out,
          },
        }),
    });
    const history = await runHotelAgent(input, [], { executorFn: executor });
    return extractToolCalls(history);
  },
  scorers: [
    createScorer<string, ToolCall[]>({
      name: "Guest name preserved",
      scorer: ({ output }) => {
        const call = output.find((tc: ToolCall) => tc.function.name === "create_reservation");
        if (!call) return 0;
        const name = call.function.arguments.guest_name ?? "";
        return name.toLowerCase().includes("alice") && name.toLowerCase().includes("johnson")
          ? 1
          : 0;
      },
    }),
    createScorer<string, ToolCall[]>({
      name: "Check-in date preserved",
      scorer: ({ output }) => {
        const call = output.find((tc: ToolCall) => tc.function.name === "create_reservation");
        if (!call) return 0;
        return call.function.arguments.check_in === "2026-05-10" ? 1 : 0;
      },
    }),
    createScorer<string, ToolCall[]>({
      name: "Check-out date preserved",
      scorer: ({ output }) => {
        const call = output.find((tc: ToolCall) => tc.function.name === "create_reservation");
        if (!call) return 0;
        return call.function.arguments.check_out === "2026-05-15" ? 1 : 0;
      },
    }),
  ],
});
