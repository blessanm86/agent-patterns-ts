// ─── Pattern 2: Dataset-Driven Evals ─────────────────────────────────────────
//
// Dataset-driven evals decouple test CASES from eval LOGIC.
// You define a table of { input, expected } pairs — as data.
// The same scoring code runs over every row.
//
// Benefits over hardcoded per-test evals:
//   - Add test cases without touching eval code — edit dataset.ts
//   - See per-case pass/fail in the evalite UI (each row is a separate run)
//   - Measure coverage by tag: how many "booking" vs "browsing" cases pass?
//   - Export dataset to Braintrust, LangSmith, or any eval platform
//
// Production teams often start here: define expected behavior as a spreadsheet,
// then build eval code that validates against it.

import { evalite, createScorer } from "evalite";
import { runHotelAgent } from "../agent.js";
import { extractToolCallNames } from "../../react/eval-utils.js";
import { createMockExecutor, scenarios } from "../fixtures/mock-tools.js";
import { evalDataset, type EvalCase } from "../fixtures/dataset.js";

// Reshape dataset so evalite's `input` field carries the full EvalCase.
// evalite auto-extracts `.input` from data items and passes it to task + scorers.
const data = evalDataset.map((c) => ({ input: c }));

evalite("Dataset-driven — tool call coverage", {
  // The entire dataset is passed to evalite. Each row becomes a separate
  // test run in the UI — you see per-case results, not just an aggregate.
  data: async () => data,

  task: async (evalCase) => {
    // Deterministic mock: available rooms + always-succeeds create_reservation.
    // This lets dataset tests focus on WHETHER tools are called, not what
    // the real data says.
    const executor = createMockExecutor({
      ...scenarios.onlySuiteAvailable,
      create_reservation: (args) =>
        JSON.stringify({
          success: true,
          reservation: {
            reservationId: `RES-DS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
            guestName: args.guest_name ?? "Guest",
            roomType: args.room_type,
            checkIn: args.check_in,
            checkOut: args.check_out,
          },
        }),
    });
    const history = await runHotelAgent(evalCase.input, [], { executorFn: executor });
    return extractToolCallNames(history);
  },

  scorers: [
    createScorer<EvalCase, string[]>({
      name: "Expected tools called",
      // All tools in expectedTools must appear in the agent's trajectory
      scorer: ({ input, output }) =>
        input.expectedTools.every((t: string) => output.includes(t)) ? 1 : 0,
    }),
    createScorer<EvalCase, string[]>({
      name: "Forbidden tools not called",
      // Tools in expectedNotTools must NOT appear in the trajectory
      scorer: ({ input, output }) => {
        const forbidden = input.expectedNotTools ?? [];
        if (forbidden.length === 0) return 1;
        return forbidden.some((t: string) => output.includes(t)) ? 0 : 1;
      },
    }),
  ],
});
