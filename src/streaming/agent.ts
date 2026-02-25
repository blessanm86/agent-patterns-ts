import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { HOTEL_SYSTEM_PROMPT } from "../shared/prompts.js";
import type { Message, SSEEvent, StreamMetrics } from "./types.js";

// ─── Emit Callback ──────────────────────────────────────────────────────────

type Emit = (event: SSEEvent) => void;

// ─── Streaming Agent ────────────────────────────────────────────────────────
//
// Same ReAct loop as src/react/agent.ts, but with two key differences:
//   1. ollama.chat() is called with stream: true
//   2. Each token chunk is emitted as a TextEvent immediately
//
// The user sees tokens appearing one-by-one instead of waiting for
// the full response. TTFT is typically 200-500ms instead of 3-10s.

export async function runStreamingAgent(
  userMessage: string,
  history: Message[],
  emit: Emit,
): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  const startTime = Date.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;
  let toolCallCount = 0;
  let iterationCount = 0;

  while (true) {
    iterationCount++;

    // ── Stream the LLM response token-by-token ────────────────────────────
    // Cast needed: `system` works at runtime but isn't in ChatRequest types.
    // The streaming overload makes @ts-expect-error insufficient, so we cast.
    const stream = await ollama.chat({
      model: MODEL,
      system: HOTEL_SYSTEM_PROMPT,
      messages,
      tools,
      stream: true,
    } as Parameters<typeof ollama.chat>[0] & { stream: true });

    let contentBuffer = "";
    let toolCalls: Message["tool_calls"] = [];

    for await (const chunk of stream) {
      // ── Text tokens — emit immediately ──────────────────────────────────
      if (chunk.message.content) {
        if (firstTokenTime === null) {
          firstTokenTime = Date.now();
        }
        tokenCount++;
        contentBuffer += chunk.message.content;
        emit({ type: "text", content: chunk.message.content });
      }

      // ── Tool calls — Ollama delivers these pre-parsed ───────────────────
      if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
        toolCalls = chunk.message.tool_calls;
      }
    }

    // Push the full assembled assistant message to history
    const assistantMessage: Message = {
      role: "assistant",
      content: contentBuffer,
    };
    if (toolCalls && toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls;
    }
    messages.push(assistantMessage);

    // ── No tool calls → done ──────────────────────────────────────────────
    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    // ── Execute tool calls and feed results back ──────────────────────────
    for (const toolCall of toolCalls) {
      const { name, arguments: args } = toolCall.function;
      toolCallCount++;

      emit({ type: "tool_call", name, arguments: args });

      const toolStart = Date.now();
      const result = executeTool(name, args as Record<string, string>);
      const durationMs = Date.now() - toolStart;

      emit({ type: "tool_result", name, result, durationMs });

      messages.push({ role: "tool", content: result });
    }
  }

  // ── Emit completion metrics ─────────────────────────────────────────────
  const totalDurationMs = Date.now() - startTime;
  const ttftMs = firstTokenTime ? firstTokenTime - startTime : totalDurationMs;
  const tokensPerSecond =
    totalDurationMs > 0 ? Math.round((tokenCount / totalDurationMs) * 1000) : 0;

  const metrics: StreamMetrics = {
    ttftMs,
    totalDurationMs,
    tokenCount,
    tokensPerSecond,
    toolCallCount,
    iterationCount,
  };

  emit({ type: "done", metrics });

  return messages;
}

// ─── Non-Streaming Agent ────────────────────────────────────────────────────
//
// Same ReAct loop, but waits for the FULL response before emitting anything.
// This is what the user experience looks like WITHOUT streaming:
// nothing → nothing → nothing → everything at once.
//
// TTFT equals total duration because no tokens appear until generation is complete.

export async function runNonStreamingAgent(
  userMessage: string,
  history: Message[],
  emit: Emit,
): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  const startTime = Date.now();
  let tokenCount = 0;
  let toolCallCount = 0;
  let iterationCount = 0;

  while (true) {
    iterationCount++;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: HOTEL_SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // Count tokens (approximate — one per word-ish chunk)
    if (assistantMessage.content) {
      tokenCount += assistantMessage.content.split(/\s+/).filter(Boolean).length;
      // Emit the ENTIRE response as a single text event
      emit({ type: "text", content: assistantMessage.content });
    }

    // ── No tool calls → done ──────────────────────────────────────────────
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // ── Execute tool calls ────────────────────────────────────────────────
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      toolCallCount++;

      emit({ type: "tool_call", name, arguments: args });

      const toolStart = Date.now();
      const result = executeTool(name, args as Record<string, string>);
      const durationMs = Date.now() - toolStart;

      emit({ type: "tool_result", name, result, durationMs });

      messages.push({ role: "tool", content: result });
    }
  }

  // ── TTFT = totalDuration because nothing appears until everything is ready ─
  const totalDurationMs = Date.now() - startTime;
  const tokensPerSecond =
    totalDurationMs > 0 ? Math.round((tokenCount / totalDurationMs) * 1000) : 0;

  const metrics: StreamMetrics = {
    ttftMs: totalDurationMs,
    totalDurationMs,
    tokenCount,
    tokensPerSecond,
    toolCallCount,
    iterationCount,
  };

  emit({ type: "done", metrics });

  return messages;
}
