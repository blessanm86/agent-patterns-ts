import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";

// ─── System Prompt ────────────────────────────────────────────────────────────
//
// A friendly recipe assistant. The system prompt tells the model to track
// dietary restrictions and preferences across the conversation — but it can
// only do that if the caller actually passes the history along.

const SYSTEM_PROMPT = `You are a friendly recipe assistant. Your job is to help users find and adapt recipes.

Important: Pay close attention to any dietary restrictions, allergies, or preferences the user mentions.
Reference them naturally in future responses (e.g., "since you mentioned you're allergic to nuts...").

Keep responses concise and helpful.`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export async function runAgent(userMessage: string, history: Message[]): Promise<Message[]> {
  // Build the full message list: all prior messages + the new user message
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // Single LLM call — no tools, no loop.
  // The model sees the full conversation history and generates a response.
  const response = await ollama.chat({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages,
  });

  // Append the assistant's reply and return the updated history.
  // The caller is responsible for storing and re-passing this on the next turn.
  messages.push(response.message);
  return messages;
}
