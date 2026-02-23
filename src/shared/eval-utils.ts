import type { Message } from "./types.js";

// Get the final assistant text response — the message the user would see.
// Excludes messages that only contain tool calls (no visible content).
export function lastAssistantMessage(history: Message[]): string {
  const textMessages = history.filter(
    (m) => m.role === "assistant" && (!m.tool_calls || m.tool_calls.length === 0),
  );
  return textMessages[textMessages.length - 1]?.content ?? "";
}
