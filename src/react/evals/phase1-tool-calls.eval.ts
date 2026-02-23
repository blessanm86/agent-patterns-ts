// ─── Phase 1: Deterministic Tool Call Evals ───────────────────────────────────
//
// These evals are deterministic — they don't use an LLM to score.
// They check the *trajectory* of tool calls the agent made:
//   - Were the right tools called?
//   - Were they called in the right order?
//   - Were the right arguments passed?
//
// This is the first thing to test for any tool-calling agent. If the trajectory
// is wrong, the final answer will be wrong regardless of how good the model is.

import { evalite, createScorer } from "evalite";
import { runAgent } from "../agent.js";
import { extractToolCallNames, extractToolCalls } from "../eval-utils.js";

// ─── Test 1: Happy Path Trajectory ────────────────────────────────────────────
//
// The agent receives everything it needs in a single message.
// A successful booking requires exactly three tools in this order:
//   check_availability → get_room_price → create_reservation
//
// If the agent skips a step or calls them out of order, something is broken
// in the system prompt or the model's reasoning.

evalite("Tool call trajectory — happy path", {
  data: async () => [
    {
      input: "My name is John Smith. Please book a double room from 2026-03-01 to 2026-03-05.",
    },
  ],
  task: async (input) => {
    const history = await runAgent(input, []);
    // Return just the ordered list of tool names — that's what we're scoring
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer({
      name: "All tools called",
      // All three tools must appear somewhere in the trajectory
      scorer: ({ output }) =>
        ["check_availability", "get_room_price", "create_reservation"].every((t) =>
          output.includes(t),
        )
          ? 1
          : 0,
    }),
    createScorer({
      name: "Correct order",
      // Availability must be checked before pricing, pricing before booking
      scorer: ({ output }) => {
        const i1 = output.indexOf("check_availability");
        const i2 = output.indexOf("get_room_price");
        const i3 = output.indexOf("create_reservation");
        return i1 !== -1 && i2 !== -1 && i3 !== -1 && i1 < i2 && i2 < i3 ? 1 : 0;
      },
    }),
  ],
});

// ─── Test 2: Availability Check Only ──────────────────────────────────────────
//
// When the user is just browsing, the agent should check availability
// but NOT proceed to booking. This tests that the agent respects intent
// and doesn't over-trigger create_reservation.

evalite("Tool call trajectory — availability check only", {
  data: async () => [
    {
      input:
        "What double rooms do you have available from 2026-04-10 to 2026-04-12? Just checking, not ready to book yet.",
    },
  ],
  task: async (input) => {
    const history = await runAgent(input, []);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer({
      name: "Availability was checked",
      scorer: ({ output }) => (output.includes("check_availability") ? 1 : 0),
    }),
    createScorer({
      name: "No reservation created",
      // The agent should NOT call create_reservation when user is just browsing
      scorer: ({ output }) => (output.includes("create_reservation") ? 0 : 1),
    }),
  ],
});

// ─── Test 3: Argument Fidelity ─────────────────────────────────────────────────
//
// Tool trajectories aren't enough — we also need to verify the agent passes
// the *correct values* through the chain. A guest name or date that gets
// garbled or dropped is a real bug even if all tools were called.

evalite("Argument fidelity — guest name and dates", {
  data: async () => [
    {
      input: "My name is Alice Johnson. I need a suite from 2026-05-10 to 2026-05-15.",
    },
  ],
  task: async (input) => {
    const history = await runAgent(input, []);
    // Return the full tool calls so we can inspect arguments
    return extractToolCalls(history);
  },
  scorers: [
    createScorer({
      name: "Guest name preserved",
      scorer: ({ output }) => {
        const reservationCall = output.find((tc) => tc.function.name === "create_reservation");
        if (!reservationCall) return 0;
        const name = reservationCall.function.arguments.guest_name ?? "";
        // Accept any reasonable casing/spacing of the name
        return name.toLowerCase().includes("alice") && name.toLowerCase().includes("johnson")
          ? 1
          : 0;
      },
    }),
    createScorer({
      name: "Check-in date preserved",
      scorer: ({ output }) => {
        const reservationCall = output.find((tc) => tc.function.name === "create_reservation");
        if (!reservationCall) return 0;
        return reservationCall.function.arguments.check_in === "2026-05-10" ? 1 : 0;
      },
    }),
    createScorer({
      name: "Check-out date preserved",
      scorer: ({ output }) => {
        const reservationCall = output.find((tc) => tc.function.name === "create_reservation");
        if (!reservationCall) return 0;
        return reservationCall.function.arguments.check_out === "2026-05-15" ? 1 : 0;
      },
    }),
  ],
});
