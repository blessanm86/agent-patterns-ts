// ─── Eval: RAG Grounding (LLM-as-Judge) ────────────────────────────────────
//
// Uses an LLM judge to check that the agent's answers are grounded in
// the retrieved documentation and don't contain hallucinated details.

import { evalite, createScorer } from "evalite";
import ollama from "ollama";
import { runAgent } from "../agent.js";
import type { Message } from "../types.js";

const MODEL = process.env.MODEL ?? "qwen2.5:7b";

function lastAssistantMessage(history: Message[]): string {
  const textMessages = history.filter(
    (m) => m.role === "assistant" && (!m.tool_calls || m.tool_calls.length === 0),
  );
  return textMessages[textMessages.length - 1]?.content ?? "";
}

function groundingJudgePrompt(question: string, answer: string): string {
  return `You are evaluating a documentation assistant for NexusDB (a fictional database).

The user asked: "${question}"

The assistant answered:
"""
${answer}
"""

NexusDB is a fictional product. The assistant should ONLY state facts that come from its documentation search results.
Any specific details (port numbers, commands, config keys) that are stated confidently but weren't from the docs are hallucinations.

Score the response from 0.0 to 1.0:
- 1.0 = Answer is well-grounded — states facts from documentation, admits uncertainty when appropriate
- 0.5 = Partially grounded — some facts from docs, some unsupported claims
- 0.0 = Heavily hallucinated — confidently states specific details not from documentation

Respond with JSON only, no other text:
{ "score": <number 0.0-1.0>, "reason": "<one sentence explanation>" }`;
}

function makeGroundingJudge(name: string) {
  return createScorer<string, string>({
    name,
    scorer: async ({ input, output }) => {
      try {
        const result = await ollama.chat({
          model: MODEL,
          messages: [
            {
              role: "user",
              content: groundingJudgePrompt(input, output),
            },
          ],
          format: "json",
        });
        const parsed = JSON.parse(result.message.content) as {
          score: number;
          reason: string;
        };
        return Math.max(0, Math.min(1, parsed.score));
      } catch {
        return 0;
      }
    },
  });
}

evalite("RAG — answers are grounded in documentation", {
  data: async () => [
    { input: "What port does NexusDB use by default?" },
    { input: "How do I create an index in NexusDB?" },
    { input: "What are the backup options in NexusDB?" },
  ],
  task: async (input) => {
    const history = await runAgent(input, [], true);
    return lastAssistantMessage(history);
  },
  scorers: [makeGroundingJudge("Grounded in docs")],
});
