// ─── Phase 2: LLM-as-Judge Evals ──────────────────────────────────────────────
//
// Deterministic scorers (Phase 1) can't answer subjective questions like:
//   "Was the agent's reply helpful?"
//   "Did it handle the edge case gracefully?"
//   "Did it communicate the reservation details clearly?"
//
// For these, we use another LLM as the judge. The judge reads the agent's
// final response and scores it against a criteria prompt.
//
// We use the same local qwen2.5:7b model for both agent and judge —
// no API keys required, fully offline.

import { evalite, createScorer } from 'evalite'
import ollama from 'ollama'
import { runAgent } from '../src/agent.js'
import { lastAssistantMessage } from '../src/eval-utils.js'

const MODEL = process.env.MODEL ?? 'qwen2.5:7b'

// ─── Judge Prompt ──────────────────────────────────────────────────────────────
//
// The judge prompt is the most important part of LLM-as-judge evals.
// Be explicit about the criteria, the scale, and the output format.
// Asking for JSON forces the model to be precise about its score.

function judgePrompt(response: string, criteria: string): string {
  return `You are evaluating a hotel reservation assistant.

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
{ "score": <number 0.0-1.0>, "reason": "<one sentence explanation>" }`
}

// ─── Custom Ollama Judge Scorer ────────────────────────────────────────────────
//
// createScorer wraps a scoring function and gives it a name for the UI.
// The scorer receives { input, output, expected? } and returns 0–1.
//
// We call Ollama directly with format: 'json' to get a structured response,
// then parse the score out of it.

function makeOllamaJudge(name: string, criteria: string) {
  return createScorer<string, string>({
    name,
    scorer: async ({ output }) => {
      try {
        const result = await ollama.chat({
          model: MODEL,
          messages: [{ role: 'user', content: judgePrompt(output, criteria) }],
          format: 'json',
        })
        const parsed = JSON.parse(result.message.content) as { score: number; reason: string }
        // Clamp to [0, 1] in case the model goes out of range
        return Math.max(0, Math.min(1, parsed.score))
      } catch {
        // If the judge fails (bad JSON, network error), score 0
        return 0
      }
    },
  })
}

// ─── Test 1: Full Booking Confirmation ────────────────────────────────────────
//
// The judge checks that the agent's final response:
//   1. Confirms the reservation was made
//   2. Includes the reservation ID (so the guest has a reference)
//   3. Echoes back the guest's name (personalisation matters)
//
// These are subjective quality checks that can't be captured by string matching.

evalite('LLM judge — reservation confirmation quality', {
  data: async () => [
    {
      input: 'My name is Bob Chen. Please book a single room from 2026-06-01 to 2026-06-03.',
    },
  ],
  task: async (input) => {
    const history = await runAgent(input, [])
    // Return only the final text response — that's what we're judging
    return lastAssistantMessage(history)
  },
  scorers: [
    makeOllamaJudge(
      'Reservation confirmed with ID',
      'Did the assistant confirm that a hotel reservation was successfully created and include a reservation ID (a code starting with RES-)?',
    ),
    makeOllamaJudge(
      'Guest name acknowledged',
      'Did the assistant address or mention the guest by name (Bob Chen) in the response?',
    ),
  ],
})

// ─── Test 2: Pricing Inquiry Handled Helpfully ────────────────────────────────
//
// When the user asks about pricing without committing to a booking,
// the agent should provide useful information without creating a reservation.
// The judge evaluates helpfulness and appropriateness of the response.

evalite('LLM judge — pricing inquiry helpfulness', {
  data: async () => [
    {
      input:
        'Can you tell me the price for a suite for 3 nights? I want to compare options before deciding.',
    },
  ],
  task: async (input) => {
    const history = await runAgent(input, [])
    return lastAssistantMessage(history)
  },
  scorers: [
    makeOllamaJudge(
      'Price information provided',
      'Did the assistant provide a specific price (in dollars) for a suite room for 3 nights?',
    ),
    makeOllamaJudge(
      'No reservation created without consent',
      'Did the assistant avoid creating a reservation (appropriate, since the user was only asking for pricing information)?',
    ),
  ],
})
