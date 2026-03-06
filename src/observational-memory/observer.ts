// ─── Observer Agent ──────────────────────────────────────────────────────────
//
// The Observer is a background agent that compresses raw conversation messages
// into dated, prioritized observation entries. It fires when the raw message
// block exceeds a token threshold.
//
// Input:  raw conversation messages that haven't been observed yet
// Output: a text block of dated observations with emoji priority flags
//
// Format:
//   Date: 2026-03-06
//   - 🔴 User is vegetarian and avoids shellfish
//   - 🟡 User asked about Mediterranean recipes
//   - 🟢 User mentioned they have a dinner party on Saturday

import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";

const OBSERVER_SYSTEM_PROMPT = `You are a memory observer. Your job is to watch a conversation between a user and a recipe assistant, then distill it into a concise list of dated observations.

Rules:
1. Extract ONLY factual, useful information — preferences, restrictions, decisions, plans, key details
2. Use this exact format for each observation:

Date: YYYY-MM-DD
- 🔴 [Important facts: dietary restrictions, allergies, strong preferences, key decisions]
- 🟡 [Moderately useful: cuisine interests, cooking skill level, household size]
- 🟢 [Context: mentioned topics, questions asked, recipes discussed]

3. Priority guide:
   - 🔴 = critical for future recommendations (allergies, dietary restrictions, strong dislikes)
   - 🟡 = useful for personalization (preferences, skill level, equipment)
   - 🟢 = helpful context (topics discussed, recipes viewed)

4. Be concise — one line per observation, no fluff
5. Merge related facts into single observations where possible
6. Use today's date for all observations unless the conversation references specific dates
7. Do NOT include observations about greetings, thanks, or small talk
8. Do NOT fabricate information — only record what was explicitly stated or clearly implied

Output ONLY the observation block — no preamble, no explanation.`;

export interface ObserverResult {
  observations: string;
  messagesConsumed: number;
}

export async function runObserver(messages: Message[], today: string): Promise<ObserverResult> {
  // Build a readable transcript of the messages for the observer
  const transcript = messages
    .map((m) => {
      if (m.role === "tool") return `[Tool result]: ${m.content}`;
      if (m.role === "assistant") {
        if (m.tool_calls && m.tool_calls.length > 0) {
          const calls = m.tool_calls
            .map((tc) => `${tc.function.name}(${JSON.stringify(tc.function.arguments)})`)
            .join(", ");
          return `Assistant [tool calls: ${calls}]: ${m.content || "(no text)"}`;
        }
        return `Assistant: ${m.content}`;
      }
      return `User: ${m.content}`;
    })
    .join("\n");

  const prompt = `Today's date: ${today}

Conversation to observe:
${transcript}

Extract observations:`;

  const response = await ollama.chat({
    model: MODEL,
    // @ts-expect-error — system not in ChatRequest types but works at runtime
    system: OBSERVER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return {
    observations: response.message.content.trim(),
    messagesConsumed: messages.length,
  };
}
