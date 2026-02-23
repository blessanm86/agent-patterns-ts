// ─── Phase 3: Plan+Execute Evals ──────────────────────────────────────────────
//
// These evals test the Plan+Execute agent — a different pattern from ReAct.
//
// The key insight for testing Plan+Execute: you can test the PLAN separately
// from the execution. The `createPlan()` function returns a structured object
// before any tools run, so you can assert on the plan structure deterministically.
//
// This is a distinct capability that ReAct doesn't have — ReAct interleaves
// reasoning and execution, so there's no "plan" to inspect ahead of time.
//
// Three evals:
//   1. Deterministic: Does the plan include the right tools?
//   2. Deterministic: Are the tool arguments correct?
//   3. LLM judge: Is the final itinerary good?

import { evalite, createScorer } from "evalite";
import ollama from "ollama";
import { createPlan, runPlanExecuteAgent } from "../agent.js";
import { lastAssistantMessage } from "../../shared/eval-utils.js";

const MODEL = process.env.MODEL ?? "qwen2.5:7b";

// ─── Judge (same pattern as phase2) ───────────────────────────────────────────

function judgePrompt(response: string, criteria: string): string {
  return `You are evaluating a trip planning assistant.

Assistant's response:
"""
${response}
"""

Evaluation criteria: ${criteria}

Score the response from 0.0 to 1.0:
- 1.0 = Fully and clearly meets the criteria
- 0.5 = Partially meets the criteria
- 0.0 = Does not meet the criteria at all

Respond with JSON only, no other text:
{ "score": <number 0.0-1.0>, "reason": "<one sentence explanation>" }`;
}

function makeOllamaJudge(name: string, criteria: string) {
  return createScorer<string, string>({
    name,
    scorer: async ({ output }) => {
      try {
        const result = await ollama.chat({
          model: MODEL,
          messages: [{ role: "user", content: judgePrompt(output, criteria) }],
          format: "json",
        });
        const parsed = JSON.parse(result.message.content) as { score: number; reason: string };
        return Math.max(0, Math.min(1, parsed.score));
      } catch {
        return 0;
      }
    },
  });
}

// ─── Eval 1: Plan covers required tools ───────────────────────────────────────
//
// The planner must include all 4 tools in its plan, and flights must come
// before hotels (you book transport before accommodation).
//
// This tests the PLAN STRUCTURE — before a single tool has run.
// This kind of eval is only possible with Plan+Execute, not ReAct.

evalite("Plan covers required tools", {
  data: async () => [
    {
      input: "Plan a 3-day trip to Paris from New York, departing 2026-07-10",
    },
  ],
  task: async (input) => {
    const plan = await createPlan(input);
    // Return just the list of tool names — what we're scoring
    return plan.steps.map((s) => s.tool);
  },
  scorers: [
    createScorer({
      name: "All 4 tools included",
      scorer: ({ output }) => {
        const required = [
          "search_flights",
          "search_hotels",
          "find_attractions",
          "find_restaurants",
        ];
        return required.every((t) => output.includes(t)) ? 1 : 0;
      },
    }),
    createScorer({
      name: "Flights before hotels",
      scorer: ({ output }) => {
        const flightIdx = output.indexOf("search_flights");
        const hotelIdx = output.indexOf("search_hotels");
        return flightIdx !== -1 && hotelIdx !== -1 && flightIdx < hotelIdx ? 1 : 0;
      },
    }),
  ],
});

// ─── Eval 2: Argument fidelity in plan ────────────────────────────────────────
//
// The plan must pass the correct arguments to each tool.
// A plan that calls search_flights with the wrong destination is broken
// even if the tool coverage looks correct.
//
// Again: we're inspecting the plan structure, not the tool outputs.
// This is deterministic — no LLM judge needed.

evalite("Plan argument fidelity", {
  data: async () => [
    {
      input: "Plan a 3-day trip to Tokyo from London, departing 2026-08-01",
    },
  ],
  task: async (input) => {
    const plan = await createPlan(input);
    return plan.steps;
  },
  scorers: [
    createScorer({
      name: "search_flights destination is Tokyo",
      scorer: ({ output }) => {
        const flightStep = output.find((s) => s.tool === "search_flights");
        if (!flightStep) return 0;
        const dest = flightStep.args.destination ?? "";
        return dest.toLowerCase().includes("tokyo") ? 1 : 0;
      },
    }),
    createScorer({
      name: "search_hotels city is Tokyo",
      scorer: ({ output }) => {
        const hotelStep = output.find((s) => s.tool === "search_hotels");
        if (!hotelStep) return 0;
        const city = hotelStep.args.city ?? "";
        return city.toLowerCase().includes("tokyo") ? 1 : 0;
      },
    }),
  ],
});

// ─── Eval 3: LLM judge — itinerary quality ────────────────────────────────────
//
// Once the full pipeline runs (plan → execute → synthesize), we judge whether
// the final itinerary is actually useful. This is a subjective quality check
// that deterministic scorers can't capture.

evalite("LLM judge — itinerary quality", {
  data: async () => [
    {
      input: "Plan a 3-day trip to Paris from New York, departing 2026-07-10",
    },
  ],
  task: async (input) => {
    const history = await runPlanExecuteAgent(input, []);
    // Return the final synthesized itinerary text
    return lastAssistantMessage(history);
  },
  scorers: [
    makeOllamaJudge(
      "Itinerary includes specific details",
      "Does the itinerary include specific flight options (with airline or price), hotel recommendations (with name), and at least 3 named attractions to visit?",
    ),
  ],
});
