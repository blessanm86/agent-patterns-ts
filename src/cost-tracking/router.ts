import ollama from "ollama";
import type { Message, ModelTier } from "./types.js";

// ─── Query Classifier ─────────────────────────────────────────────────────────
//
// Uses the fast (smallest) model to classify each user query into a model tier.
// This is the cheapest LLM call in the pipeline — it decides how much to spend
// on the real work.
//
// Classification rules:
//   fast     → greetings, yes/no, acknowledgments, simple FAQ
//   standard → needs tool calls (availability, pricing, booking)
//   capable  → multi-room comparison, complex reasoning over multiple results

export interface ClassifyResult {
  tier: ModelTier;
  reason: string;
  inputTokens: number;
  outputTokens: number;
}

const CLASSIFY_PROMPT = `You are a query complexity classifier for a hotel reservation assistant.

Given the user's message and conversation context, classify the query into one of three tiers:

- "fast": Greetings, simple yes/no answers, acknowledgments, thank-you messages, simple FAQ questions that don't need tools (e.g. "Hi", "Thanks!", "Yes please", "What are your room types?")
- "standard": Queries that need tool calls — checking availability, getting prices, making reservations (e.g. "Book a double room from March 1-5", "What rooms are available next week?")
- "capable": Complex queries requiring reasoning over multiple tool results — comparing room types, multi-step calculations, weighing tradeoffs (e.g. "Compare all room types for a 5-night stay and recommend the best value", "I need two rooms for different dates, what's the cheapest combination?")

Respond with JSON: { "tier": "fast" | "standard" | "capable", "reason": "<brief explanation>" }`;

export async function classifyQuery(
  message: string,
  history: Message[],
  fastModel: string,
): Promise<ClassifyResult> {
  // Build a brief context summary so the classifier knows where we are in the conversation
  const recentContext = history
    .slice(-4)
    .map((m) => `${m.role}: ${m.content?.slice(0, 100) ?? "[tool call]"}`)
    .join("\n");

  const userPrompt = recentContext
    ? `Recent conversation:\n${recentContext}\n\nNew message: "${message}"`
    : `New message: "${message}"`;

  const response = await ollama.chat({
    model: fastModel,
    messages: [
      { role: "system", content: CLASSIFY_PROMPT },
      { role: "user", content: userPrompt },
    ],
    format: "json",
  });

  const inputTokens = response.prompt_eval_count ?? 0;
  const outputTokens = response.eval_count ?? 0;

  // Parse the classification — fall back to "standard" if parsing fails
  try {
    const parsed = JSON.parse(response.message.content);
    const tier = ["fast", "standard", "capable"].includes(parsed.tier) ? parsed.tier : "standard";
    return {
      tier,
      reason: parsed.reason ?? "no reason provided",
      inputTokens,
      outputTokens,
    };
  } catch {
    return {
      tier: "standard",
      reason: "classification parse failed — defaulting to standard",
      inputTokens,
      outputTokens,
    };
  }
}
