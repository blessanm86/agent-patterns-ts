// ─── Pattern 4: Error Injection Evals ────────────────────────────────────────
//
// Error injection forces specific tool failures to test agent resilience.
//
// Without mocked tools, you can't reliably trigger error paths.
// Real tools only fail if the underlying data happens to be in an error state —
// you can't reproduce the failure on demand, and tests become flaky.
//
// With error injection, you control exactly:
//   - Which tool fails
//   - What error it returns
//   - When (always, once, after N calls)
//
// This tests four critical failure modes:
//   1. No rooms available — agent must communicate clearly, not fabricate
//   2. Booking conflict — reservation fails after availability succeeds
//   3. Service unavailable — total outage, all tools return errors
//   4. Transient failure — tool fails once then recovers
//
// These patterns directly test the error-recovery behavior from Concept 13
// (LLM Error Recovery with Retry). Use error injection to verify your
// recovery logic actually works.

import { evalite, createScorer } from "evalite";
import { runHotelAgent } from "../agent.js";
import { lastAssistantMessage } from "../../shared/eval-utils.js";
import { extractToolCallNames } from "../../react/eval-utils.js";
import { createMockExecutor, scenarios, makeFailThenSucceed } from "../fixtures/mock-tools.js";

// ─── Test 1: No rooms available ───────────────────────────────────────────────

evalite("Error injection — no rooms available", {
  data: async () => [
    { input: "My name is Dana Park. Book a double room from 2026-08-01 to 2026-08-05." },
  ],
  task: async (input) => {
    const executor = createMockExecutor(scenarios.noRoomsAvailable);
    const history = await runHotelAgent(input, [], { executorFn: executor });
    return lastAssistantMessage(history);
  },
  scorers: [
    createScorer({
      name: "Agent reports unavailability",
      scorer: ({ output }) => {
        const lower = output.toLowerCase();
        return lower.includes("no") &&
          (lower.includes("available") || lower.includes("unavailable") || lower.includes("room"))
          ? 1
          : 0;
      },
    }),
    createScorer({
      name: "No fabricated reservation",
      scorer: ({ output }) => {
        // Agent must not claim to have booked a room when none were available
        const lower = output.toLowerCase();
        const falseClaim =
          lower.includes("res-") || (lower.includes("confirmed") && lower.includes("reservation"));
        return falseClaim ? 0 : 1;
      },
    }),
    createScorer({
      name: "Agent produces a response",
      scorer: ({ output }) => (output.trim().length > 10 ? 1 : 0),
    }),
  ],
});

// ─── Test 2: Booking conflict ─────────────────────────────────────────────────
//
// Availability returns rooms (agent proceeds to book), but create_reservation
// fails with a conflict error. Tests that the agent does not falsely confirm
// a reservation that actually failed.

evalite("Error injection — booking conflict", {
  data: async () => [
    {
      input: "I'm Evan Torres. Please book a single room from 2026-09-10 to 2026-09-13. I confirm.",
    },
  ],
  task: async (input) => {
    const executor = createMockExecutor({
      ...scenarios.onlySuiteAvailable,
      create_reservation: () =>
        JSON.stringify({ success: false, error: "Reservation conflict: room no longer available" }),
    });
    const history = await runHotelAgent(input, [], { executorFn: executor });
    return lastAssistantMessage(history);
  },
  scorers: [
    createScorer({
      name: "Agent communicates booking failure",
      scorer: ({ output }) => {
        const lower = output.toLowerCase();
        return lower.includes("error") ||
          lower.includes("unable") ||
          lower.includes("failed") ||
          lower.includes("conflict") ||
          lower.includes("sorry") ||
          lower.includes("not") ||
          lower.includes("unfortunately")
          ? 1
          : 0;
      },
    }),
    createScorer({
      name: "No false confirmation",
      scorer: ({ output }) => {
        // create_reservation returned success:false — agent must not claim it succeeded
        const lower = output.toLowerCase();
        const falseConfirmation =
          lower.includes("res-") || (lower.includes("confirmed") && lower.includes("reservation"));
        return falseConfirmation ? 0 : 1;
      },
    }),
  ],
});

// ─── Test 3: Total service outage ─────────────────────────────────────────────
//
// All tools return service errors. The agent must handle complete failure
// without crashing, hanging, or fabricating availability.

evalite("Error injection — service unavailable", {
  data: async () => [{ input: "What rooms do you have available from 2026-10-01 to 2026-10-03?" }],
  task: async (input) => {
    const executor = createMockExecutor(scenarios.serviceUnavailable);
    const history = await runHotelAgent(input, [], { executorFn: executor });
    return lastAssistantMessage(history);
  },
  scorers: [
    createScorer({
      name: "Agent reports service issue",
      scorer: ({ output }) => {
        const lower = output.toLowerCase();
        return lower.includes("unavailable") ||
          lower.includes("error") ||
          lower.includes("service") ||
          lower.includes("try again") ||
          lower.includes("issue") ||
          lower.includes("problem") ||
          lower.includes("unable")
          ? 1
          : 0;
      },
    }),
    createScorer({
      name: "Agent produces a response",
      scorer: ({ output }) => (output.trim().length > 10 ? 1 : 0),
    }),
  ],
});

// ─── Test 4: Transient failure recovery ───────────────────────────────────────
//
// makeFailThenSucceed(1) makes check_availability fail once, then succeed.
// Tests whether the agent recovers from a transient error:
//   - Does it retry? (ideal)
//   - Does it communicate the error and ask to try again? (acceptable)
//   - Does it silently produce nothing? (failure)
//
// This is a direct test of Concept 13 (LLM Error Recovery) behavior.

evalite("Error injection — transient failure recovery", {
  data: async () => [{ input: "What double rooms are available from 2026-11-05 to 2026-11-08?" }],
  task: async (input) => {
    // Fresh counter per test — makeFailThenSucceed is a factory, not a singleton
    const executor = createMockExecutor(makeFailThenSucceed(1));
    const history = await runHotelAgent(input, [], { executorFn: executor });
    return {
      tools: extractToolCallNames(history),
      response: lastAssistantMessage(history),
    };
  },
  scorers: [
    createScorer({
      name: "check_availability was attempted",
      // Agent should try the tool even if it knows it might fail
      scorer: ({ output }) => (output.tools.includes("check_availability") ? 1 : 0),
    }),
    createScorer({
      name: "Agent produced a response",
      scorer: ({ output }) => (output.response.trim().length > 10 ? 1 : 0),
    }),
  ],
});
