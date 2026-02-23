import type { Message, ToolCall } from './types.js'

// ─── Eval Utilities ───────────────────────────────────────────────────────────
//
// Helpers for inspecting agent history in eval assertions.
// All three functions work by filtering the returned Message[] from runAgent().

// Extract the ordered list of tool names called during a run.
// Use this for trajectory assertions: did the agent call the right tools
// in the right order?
export function extractToolCallNames(history: Message[]): string[] {
  return history
    .filter(
      (m): m is Message & { tool_calls: ToolCall[] } =>
        m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    )
    .flatMap((m) => m.tool_calls.map((tc) => tc.function.name))
}

// Extract the full tool calls (name + arguments) for argument-level assertions.
// Use this when you need to verify that the agent passed the correct values
// to a specific tool (e.g., the right guest name, the right dates).
export function extractToolCalls(history: Message[]): ToolCall[] {
  return history
    .filter(
      (m): m is Message & { tool_calls: ToolCall[] } =>
        m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    )
    .flatMap((m) => m.tool_calls)
}

// Get the final assistant text response — the message the user would see.
// Excludes messages that only contain tool calls (no visible content).
export function lastAssistantMessage(history: Message[]): string {
  const textMessages = history.filter(
    (m) => m.role === 'assistant' && (!m.tool_calls || m.tool_calls.length === 0),
  )
  return textMessages[textMessages.length - 1]?.content ?? ''
}
