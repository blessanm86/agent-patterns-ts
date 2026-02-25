// ─── Pattern 3: LLM-as-Judge Evals ───────────────────────────────────────────
//
// Some quality dimensions can't be captured by string matching or tool checks:
//   - Is the response clear and well-organized for a hotel guest?
//   - Did the agent communicate an error helpfully?
//   - Does the pricing in the response match what the tools actually returned?
//
// For these, we use a second LLM call as the "judge". The judge reads the
// agent's output and scores it against a rubric, returning 0.0–1.0.
//
// This eval adds three improvements over basic LLM-as-judge:
//
// 1. MULTI-CRITERIA RUBRICS
//    Separate scores for different dimensions (confirmed ID, named guest,
//    pricing accuracy, clarity) instead of a single "is it good?" score.
//    This pinpoints WHICH quality dimension is failing, not just that it failed.
//
// 2. BIAS MITIGATION
//    The judge prompt includes: "do not favor longer or more verbose responses."
//    MT-Bench (Zheng et al., 2023) documented verbosity bias — LLM judges
//    consistently prefer longer answers even when shorter answers are better.
//    An explicit anti-verbosity instruction reduces this bias.
//
// 3. FACTUALITY GROUNDING
//    The judge receives the actual tool results alongside the agent's response.
//    It can detect contradictions: e.g., agent says "$200/night" when
//    check_availability returned "$350/night". Without tool context, the judge
//    can only evaluate style, not accuracy.

import { evalite, createScorer } from "evalite";
import ollama from "ollama";
import { runHotelAgent } from "../agent.js";
import { lastAssistantMessage } from "../../shared/eval-utils.js";
import { createMockExecutor, scenarios } from "../fixtures/mock-tools.js";

const MODEL = process.env.MODEL ?? "qwen2.5:7b";

// ─── Judge Factory ─────────────────────────────────────────────────────────────
//
// Each call to makeJudge() creates a scorer for one specific criterion.
// The scorer receives { response, toolContext } and scores 0.0–1.0.
//
// Improvements over basic judge:
//   - Anti-verbosity instruction (bias mitigation)
//   - Optional toolContext for factuality grounding
//   - Chain-of-thought: judge explains reasoning in "reason" field before scoring

function makeJudge(name: string, criteria: string) {
  return createScorer<string, { response: string; toolContext?: string }>({
    name,
    scorer: async ({ output }) => {
      const contextBlock = output.toolContext
        ? `\nTool results the agent received:\n"""\n${output.toolContext}\n"""\n`
        : "";

      const prompt = `You are evaluating a hotel reservation assistant's response.${contextBlock}
Assistant's response:
"""
${output.response}
"""

Evaluation criteria: ${criteria}

Important: Do not favor longer or more verbose responses. A concise, accurate answer
scores as high as a detailed one. Only evaluate whether the criteria is met.

Think step by step, then score the response 0.0 to 1.0:
- 1.0 = Fully meets the criteria
- 0.5 = Partially meets the criteria
- 0.0 = Does not meet the criteria

Respond with JSON only:
{ "score": <number 0.0-1.0>, "reason": "<one sentence>" }`;

      try {
        const result = await ollama.chat({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
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

// ─── Test 1: Multi-criteria booking confirmation quality ───────────────────────
//
// Four separate criteria scored independently.
// If the agent passes "clarity" but fails "pricing accuracy", you know exactly
// what to fix — not just that it scored 0.5 overall.

evalite("LLM judge — multi-criteria booking quality", {
  data: async () => [
    { input: "My name is Bob Chen. Book a single room from 2026-06-01 to 2026-06-03." },
  ],
  task: async (input) => {
    const executor = createMockExecutor({
      check_availability: () =>
        JSON.stringify({
          available: true,
          nights: 2,
          rooms: [{ type: "single", pricePerNight: 120, totalPrice: 240 }],
        }),
      create_reservation: () =>
        JSON.stringify({
          success: true,
          reservation: {
            reservationId: "RES-JUDGE-001",
            guestName: "Bob Chen",
            roomType: "single",
            checkIn: "2026-06-01",
            checkOut: "2026-06-03",
            totalPrice: 240,
          },
        }),
    });
    const history = await runHotelAgent(input, [], { executorFn: executor });
    const response = lastAssistantMessage(history);
    // Pass tool context to the judge for factuality grounding
    const toolContext =
      "check_availability: 1 single room at $120/night, $240 total for 2 nights. " +
      "create_reservation: success, ID RES-JUDGE-001, guest Bob Chen";
    return { response, toolContext };
  },
  scorers: [
    makeJudge(
      "Reservation confirmed with ID",
      "Did the assistant confirm the reservation was created and include the ID (RES-JUDGE-001)?",
    ),
    makeJudge(
      "Guest name acknowledged",
      "Did the assistant mention or address the guest by name (Bob Chen)?",
    ),
    makeJudge(
      "Pricing accuracy",
      "Does the response accurately state the price ($120/night, $240 total for 2 nights)? Use the tool results to verify.",
    ),
    makeJudge(
      "Response clarity",
      "Is the response clear, well-organized, and easy for a hotel guest to understand? Concise answers score equally to detailed ones.",
    ),
  ],
});

// ─── Test 2: Error communication quality ──────────────────────────────────────
//
// When availability returns nothing, the agent's job is to communicate clearly
// and helpfully. Three criteria: did it say no rooms? did it avoid fabricating
// availability? did it suggest next steps?

evalite("LLM judge — error communication quality", {
  data: async () => [
    { input: "I'm Carol White. Book a double room from 2026-07-10 to 2026-07-12." },
  ],
  task: async (input) => {
    const executor = createMockExecutor(scenarios.noRoomsAvailable);
    const history = await runHotelAgent(input, [], { executorFn: executor });
    const response = lastAssistantMessage(history);
    const toolContext = "check_availability returned: no rooms available for those dates";
    return { response, toolContext };
  },
  scorers: [
    makeJudge(
      "Unavailability clearly communicated",
      "Did the assistant clearly tell the guest that no rooms are available for their requested dates?",
    ),
    makeJudge(
      "No false information",
      "Did the assistant avoid inventing availability or making a booking? Use the tool results to verify — check_availability returned no rooms.",
    ),
    makeJudge(
      "Helpful recovery suggestion",
      "Did the assistant offer a helpful next step — e.g., suggest trying different dates or ask for flexibility?",
    ),
  ],
});
