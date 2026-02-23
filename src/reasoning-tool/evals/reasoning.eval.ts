// ─── Reasoning Tool Evals ─────────────────────────────────────────────────────
//
// These evals verify two things about the reasoning tool agent:
//
// 1. Trajectory: did the agent call think first, then look up the order,
//    then check policy, then process the refund?
//
// 2. Quality (LLM-as-judge): does the final response clearly explain
//    the outcome and the reason?
//
// The trajectory check is deterministic and fast.
// The quality check uses the same local model as a judge.

import { evalite, createScorer } from "evalite";
import ollama from "ollama";
import { runAgent } from "../agent.js";
import { extractToolCallNames } from "../../react/eval-utils.js";
import { lastAssistantMessage } from "../../shared/eval-utils.js";

const MODEL = process.env.MODEL ?? "qwen2.5:7b";

// ─── Test 1: Eligible Refund Trajectory (ORD-001) ─────────────────────────────
//
// ORD-001: Laptop Stand, $89, 13 days old → should auto-approve
//
// Expected trajectory:
//   think → lookup_order → think → check_refund_policy → think → process_refund → think
//
// We check two things:
//   - think was called at least once (structured reasoning happened)
//   - process_refund was called (decision was recorded)

evalite("Eligible refund — think called and refund processed (ORD-001)", {
  data: async () => [
    {
      input: "I want a refund on order ORD-001.",
    },
  ],
  task: async (input) => {
    const history = await runAgent(input, []);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer({
      name: "Think tool called",
      scorer: ({ output }) => (output.includes("think") ? 1 : 0),
    }),
    createScorer({
      name: "Think called before process_refund",
      scorer: ({ output }) => {
        const thinkIdx = output.indexOf("think");
        const refundIdx = output.indexOf("process_refund");
        return thinkIdx !== -1 && refundIdx !== -1 && thinkIdx < refundIdx ? 1 : 0;
      },
    }),
    createScorer({
      name: "Process refund called",
      scorer: ({ output }) => (output.includes("process_refund") ? 1 : 0),
    }),
  ],
});

// ─── Test 2: Ineligible Refund Trajectory (ORD-002) ───────────────────────────
//
// ORD-002: Mechanical Keyboard, $220, 44 days old → should deny (too old)
//
// The agent must still call process_refund to record the denial — it shouldn't
// just skip the step because the answer is no.

evalite("Ineligible refund — denial recorded via process_refund (ORD-002)", {
  data: async () => [
    {
      input: "Can I get a refund on ORD-002?",
    },
  ],
  task: async (input) => {
    const history = await runAgent(input, []);
    return extractToolCallNames(history);
  },
  scorers: [
    createScorer({
      name: "Think tool called",
      scorer: ({ output }) => (output.includes("think") ? 1 : 0),
    }),
    createScorer({
      name: "Lookup order called",
      scorer: ({ output }) => (output.includes("lookup_order") ? 1 : 0),
    }),
    createScorer({
      name: "Process refund called",
      scorer: ({ output }) => (output.includes("process_refund") ? 1 : 0),
    }),
  ],
});

// ─── Test 3: LLM Judge — Response Quality ─────────────────────────────────────
//
// A correct trajectory doesn't guarantee a good user-facing response.
// The judge checks whether the final message clearly explains the outcome.

function judgePrompt(response: string, criteria: string): string {
  return `You are evaluating a refund decision agent's response.

Agent's response:
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

evalite("LLM judge — refund response clearly explains outcome", {
  data: async () => [
    {
      input: "I want to return my Laptop Stand, order ORD-001.",
    },
  ],
  task: async (input) => {
    const history = await runAgent(input, []);
    return lastAssistantMessage(history);
  },
  scorers: [
    makeOllamaJudge(
      "Outcome stated clearly",
      "Does the response clearly state whether the refund was approved or denied?",
    ),
    makeOllamaJudge(
      "Reason provided",
      "Does the response explain why the refund was approved or denied (e.g. days since purchase, amount)?",
    ),
  ],
});
