import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import type { Message } from "../shared/types.js";

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a friendly hotel reservation assistant for The Grand TypeScript Hotel.

Your goal is to help guests make a room reservation. Follow these steps in order:

1. Greet the guest and ask for their name
2. Ask for their desired check-in and check-out dates
3. Use the check_availability tool to find available rooms
4. Present the options clearly (room types and prices)
5. Ask the guest which room type they'd like
6. Use get_room_price to confirm the total cost and present it to the guest
7. Ask for confirmation before proceeding
8. Once confirmed, use create_reservation to book the room
9. Confirm the booking with the reservation ID

Important rules:
- Always use tools to check real availability and prices — never make up numbers
- Dates must be in YYYY-MM-DD format (e.g. 2026-03-15) when calling tools
- If a tool returns an error, read it carefully and fix the problem before retrying
- If no rooms are available, suggest different dates
- Valid room types are: single, double, suite`;

// ─── Recovery Mode ────────────────────────────────────────────────────────────
//
// Three strategies for handling tool errors, each with a different answer to:
// "What information does the LLM get in the tool result message?"
//
//   crash       — stop immediately; no tool result at all; the agent fails
//   blind       — return the raw error JSON; the model must guess what to fix
//   corrective  — return error + a specific hint explaining exactly how to fix it
//
// The key insight: all three strategies play out in the same ReAct loop.
// The only difference is what we put in the `role: 'tool'` message.

export type RecoveryMode = "crash" | "blind" | "corrective";

// 2 retries = 3 total attempts (initial + 2 retries).
// 1 retry resolves most semantic errors; 2 is a generous backstop.
export const MAX_TOOL_RETRIES = 2;

// ─── Error Classification Map ─────────────────────────────────────────────────
//
// Each error code maps to:
//   retryable — whether giving the model another attempt makes sense
//   hint      — the specific corrective instruction we add in corrective mode
//
// Hints are the corrective prompts. They need to be specific, not generic.
// "Try again" is useless. "Dates must be YYYY-MM-DD format, e.g. 2026-03-15" works.

const ERROR_HINTS: Record<string, { retryable: boolean; hint: string }> = {
  invalid_date_format: {
    retryable: true,
    hint: "Dates must be YYYY-MM-DD format, e.g. 2026-03-15. Convert any natural language dates.",
  },
  checkout_before_checkin: {
    retryable: true,
    hint: "check_out must be at least 1 day after check_in.",
  },
  unknown_room_type: {
    retryable: true,
    hint: "Valid room types are: 'single', 'double', 'suite'. No other values are accepted.",
  },
  no_rooms_available: {
    retryable: true,
    hint: "Try a different room_type or inform the guest no rooms are available.",
  },
  reservation_conflict: {
    retryable: false,
    hint: "Room was just taken by another guest. Call check_availability again to find an available room.",
  },
  missing_required_field: {
    retryable: true,
    hint: "All required fields must be non-empty. Ask the guest for the missing information.",
  },
};

// ─── Tool Stats ───────────────────────────────────────────────────────────────

export interface ToolStats {
  calls: number;
  errors: number;
  recovered: number; // errors where the model retried and eventually succeeded
  failed: number; // errors that hit max retries or were fatal
}

// ─── Result Type ──────────────────────────────────────────────────────────────

export interface AgentResult {
  messages: Message[];
  mode: RecoveryMode;
  toolStats: ToolStats;
}

// ─── Model ────────────────────────────────────────────────────────────────────

const MODEL = process.env.MODEL ?? "qwen2.5:7b";

// ─── Main: ReAct Loop with Pluggable Recovery ─────────────────────────────────
//
// The recovery strategy is entirely owned here — tools.ts has no mode awareness.
// The ReAct loop itself is identical across all modes; the difference is only
// in what string gets pushed as the tool result message.

export async function runAgentWithRecovery(
  userMessage: string,
  history: Message[],
  mode: RecoveryMode,
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const stats: ToolStats = { calls: 0, errors: 0, recovered: 0, failed: 0 };

  // Track how many times each tool has errored this turn.
  // Key: tool name. Value: number of error attempts so far.
  // Simple heuristic — enough for the demo without per-call-instance tracking.
  const toolErrorCounts = new Map<string, number>();

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // ── No tool calls → agent is done reasoning ───────────────────────────────
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // ── Tool calls → execute and apply recovery strategy ──────────────────────
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const errorCount = toolErrorCounts.get(name) ?? 0;
      const isRetry = errorCount > 0;

      console.log(
        `\n  🔧 Tool call: ${name}${isRetry ? ` [retry ${errorCount}/${MAX_TOOL_RETRIES}]` : ""}`,
      );
      console.log(`     Args: ${JSON.stringify(args, null, 2).replace(/\n/g, "\n     ")}`);

      stats.calls++;

      const rawResult = executeTool(name, args as Record<string, string>);

      // Parse to check for error field
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawResult) as Record<string, unknown>;
      } catch {
        parsed = {};
      }

      const errorCode = typeof parsed.error === "string" ? parsed.error : null;
      const isError = errorCode !== null;

      if (!isError) {
        // Success
        if (isRetry) {
          // It errored before but succeeded now → recovered
          stats.recovered++;
        }
        console.log(`     ✅ Result: ${rawResult}`);
        messages.push({ role: "tool", content: rawResult });
        // Reset error count for this tool on success
        toolErrorCounts.delete(name);
        continue;
      }

      // ── Error path: apply recovery strategy ───────────────────────────────
      stats.errors++;
      const errorMsg = typeof parsed.message === "string" ? parsed.message : errorCode;
      console.log(`     ❌ Error: ${errorCode} — "${errorMsg}"`);

      if (mode === "crash") {
        // Crash mode: stop everything; inject a failure message without an LLM call
        console.log(`     💥 [crash mode] Stopping agent — not retrying`);
        stats.failed++;
        messages.push({
          role: "assistant",
          content: `I encountered an error and cannot continue: ${errorMsg}. Please try again.`,
        });
        return { messages, mode, toolStats: stats };
      }

      // blind and corrective both return a tool result so the loop continues
      const newErrorCount = errorCount + 1;
      toolErrorCounts.set(name, newErrorCount);

      const hintInfo = ERROR_HINTS[errorCode];
      const isRetryable = hintInfo?.retryable ?? true;
      const retriesRemaining = MAX_TOOL_RETRIES - newErrorCount;

      if (!isRetryable || retriesRemaining < 0) {
        // Fatal or exhausted retries
        stats.failed++;
        console.log(
          isRetryable
            ? `     🚫 Max retries (${MAX_TOOL_RETRIES}) exhausted`
            : `     🚫 Fatal error — not retryable`,
        );

        const fatalResult =
          mode === "corrective"
            ? JSON.stringify({
                ...parsed,
                hint: isRetryable
                  ? "Max retries exceeded. Tell the guest you cannot complete this step and ask them to try different options."
                  : (hintInfo?.hint ?? "This error cannot be recovered from automatically."),
                fatal: true,
              })
            : rawResult; // blind: just the raw error

        messages.push({ role: "tool", content: fatalResult });
        continue;
      }

      if (mode === "blind") {
        // Blind mode: raw error only — the model must guess what to fix
        console.log(`     🔁 [blind mode] Returning raw error — model must self-correct`);
        messages.push({ role: "tool", content: rawResult });
      } else {
        // Corrective mode: error + specific hint + retries remaining
        const hint = hintInfo?.hint ?? "Check the parameter values and try again.";
        console.log(`     💡 Hint: ${hint}`);

        const correctiveResult = JSON.stringify({
          ...parsed,
          hint,
          retriesRemaining,
        });
        messages.push({ role: "tool", content: correctiveResult });
      }
    }

    // Loop — model now reasons about the tool results
  }

  // Tally remaining error counts as failed (errors that never recovered)
  for (const count of toolErrorCounts.values()) {
    if (count > 0) stats.failed++;
  }

  return { messages, mode, toolStats: stats };
}
