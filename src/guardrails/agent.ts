import ollama from "ollama";
import { tools, executeToolAsync } from "./tools.js";
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
- If no rooms are available, suggest different dates
- Be concise and friendly
- Dates should be in YYYY-MM-DD format when calling tools`;

// ─── Guardrail Configuration ──────────────────────────────────────────────────
//
// All limits in one place so they're easy to tune and reference in index.ts.

export interface GuardrailConfig {
  maxIterations: number; // Stops infinite reasoning loops
  maxTokens: number; // Stops context window exhaustion
  toolTimeoutMs: number; // Stops hanging tool calls
  maxInputLength: number; // Stops malformed or malicious input
}

export const GUARDRAILS: GuardrailConfig = {
  maxIterations: 15, // LangChain default; Vercel default is 20; 10–25 practitioner consensus
  maxTokens: 6_000, // Demo-friendly; real-world ≈ 75% of model's context window (~24K for qwen2.5:7b)
  toolTimeoutMs: 10_000, // 10s for internal tools; README explains 30s for real APIs
  maxInputLength: 2_000, // ~500 tokens; sufficient for any hotel reservation request
};

// ─── Result Types ─────────────────────────────────────────────────────────────

export type StopReason =
  | "natural"
  | "max-iterations"
  | "token-budget"
  | "timeout"
  | "input-validation";

export interface AgentResult {
  messages: Message[];
  stoppedBy: StopReason;
  totalTokens: number;
  iterations: number;
}

// ─── Model ────────────────────────────────────────────────────────────────────

const MODEL = process.env.MODEL ?? "qwen2.5:7b";

// ─── Guardrail 1: Input Validation ───────────────────────────────────────────
//
// Checked before the loop starts. Returns an error string if invalid,
// null if input is safe to process.
//
// Catches:
//   - Inputs too long to be a legitimate hotel request
//   - Common prompt injection patterns

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+a/i,
  /system\s*prompt/i,
];

function validateInput(input: string): string | null {
  if (input.length > GUARDRAILS.maxInputLength) {
    return `Input too long (${input.length} chars, max ${GUARDRAILS.maxInputLength}).`;
  }
  if (INJECTION_PATTERNS.some((p) => p.test(input))) {
    return "I can only help with hotel reservations.";
  }
  return null;
}

// ─── Guardrail 4: Tool Timeout ────────────────────────────────────────────────
//
// Wraps each tool execution in a Promise.race() against a timeout.
// The timeout error is returned as a tool result (not thrown), so the LLM
// can reason about it and attempt recovery. The iteration + token limits
// provide the overall backstop if the agent keeps trying.

async function withTimeout(name: string, args: Record<string, string>): Promise<string> {
  const timeout = new Promise<string>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Tool '${name}' timed out after ${GUARDRAILS.toolTimeoutMs}ms`)),
      GUARDRAILS.toolTimeoutMs,
    ),
  );
  try {
    return await Promise.race([executeToolAsync(name, args), timeout]);
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// ─── Main: Guarded ReAct Loop ─────────────────────────────────────────────────

export async function runGuardedAgent(
  userMessage: string,
  history: Message[],
): Promise<AgentResult> {
  // ── Guardrail 1: Input Validation ──────────────────────────────────────────
  const validationError = validateInput(userMessage);
  if (validationError) {
    const rejectMessage: Message = { role: "assistant", content: validationError };
    return {
      messages: [...history, { role: "user", content: userMessage }, rejectMessage],
      stoppedBy: "input-validation",
      totalTokens: 0,
      iterations: 0,
    };
  }

  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  let totalTokens = 0;
  let iterations = 0;

  while (true) {
    // ── Guardrail 2: Max Iterations ─────────────────────────────────────────
    //
    // "Generate" degradation: one final synthesis call so the agent can surface
    // partial results rather than returning a hard-coded error string.
    if (iterations >= GUARDRAILS.maxIterations) {
      console.log(
        `\n  ⚡ Max iterations (${GUARDRAILS.maxIterations}) reached — synthesizing partial results`,
      );

      const synthesis = await ollama.chat({
        model: MODEL,
        system: SYSTEM_PROMPT,
        messages: [
          ...messages,
          {
            role: "user",
            content: `You have reached the maximum number of steps (${GUARDRAILS.maxIterations}). Summarize what you found so far and tell the guest what they should do next to complete their reservation.`,
          },
        ],
      });

      messages.push(synthesis.message as Message);
      return { messages, stoppedBy: "max-iterations", totalTokens, iterations };
    }

    const response = await ollama.chat({
      model: MODEL,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    iterations++;

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // ── Guardrail 3: Token Budget ───────────────────────────────────────────
    //
    // Ollama exposes prompt_eval_count (input tokens) and eval_count (output tokens).
    // We accumulate across all iterations. When the budget is exhausted we stop
    // immediately — no synthesis call, because we may not have tokens to spare.
    totalTokens += (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0);

    if (totalTokens > GUARDRAILS.maxTokens) {
      console.log(
        `\n  ⚡ Token budget (${GUARDRAILS.maxTokens}) exceeded at ${totalTokens} tokens`,
      );

      messages.push({
        role: "assistant",
        content: `[Token budget of ${GUARDRAILS.maxTokens} reached after ${iterations} steps. Based on what I gathered: please contact the front desk at extension 0 to complete your reservation.]`,
      });

      return { messages, stoppedBy: "token-budget", totalTokens, iterations };
    }

    // ── No tool calls → agent is done reasoning ───────────────────────────
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return { messages, stoppedBy: "natural", totalTokens, iterations };
    }

    // ── Tool calls → execute each with timeout guardrail ─────────────────
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;

      console.log(`\n  🔧 Tool call: ${name}`);
      console.log(`     Args: ${JSON.stringify(args, null, 2).replace(/\n/g, "\n     ")}`);

      // Guardrail 4 applied here: each call is raced against toolTimeoutMs
      const result = await withTimeout(name, args as Record<string, string>);

      console.log(`     Result: ${result}`);

      messages.push({ role: "tool", content: result });
    }

    // Loop — model now reasons about the tool results
  }
}
