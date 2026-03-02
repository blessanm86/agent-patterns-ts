import ollama from "ollama";
import type { Message, ToolDefinition } from "../shared/types.js";
import type { AgentContext, LLMResponse, Middleware, ToolCallContext } from "./middleware.js";
import { runHook, runLLMHook, runToolHook } from "./middleware.js";

// ─── Agent Configuration ─────────────────────────────────────────────────────

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  executeTool: (name: string, args: Record<string, string>) => string;
  middlewares?: Middleware[];
}

export interface AgentResult {
  messages: Message[];
  metadata: Record<string, unknown>;
}

// ─── Middleware-Aware Agent Loop ──────────────────────────────────────────────
//
// This is the same ReAct while(true) loop as src/react/agent.ts, but every
// natural interception point fires hooks through the middleware pipeline.
//
// The 6 hook points:
//   beforeAgentLoop  → once, before the while(true) starts
//   beforeLLMCall    → before each ollama.chat()
//   afterLLMCall     → after each ollama.chat() response
//   beforeToolExecution → before each tool runs
//   afterToolExecution  → after each tool runs (can mutate result)
//   afterAgentLoop   → once, after while(true) breaks

export async function runAgentWithMiddleware(
  userMessage: string,
  history: Message[],
  config: AgentConfig,
): Promise<AgentResult> {
  const middlewares = config.middlewares ?? [];

  // Build the shared context that all middleware reads and writes
  const ctx: AgentContext = {
    messages: [...history, { role: "user", content: userMessage }],
    model: config.model,
    tools: config.tools,
    systemPrompt: config.systemPrompt,
    executeTool: config.executeTool,
    metadata: {},
  };

  // ── beforeAgentLoop ─────────────────────────────────────────────────────
  await runHook(middlewares, "beforeAgentLoop", ctx);
  if (ctx.abort) {
    return buildAbortResult(ctx);
  }

  // ── The ReAct Loop (with middleware at every interception point) ────────
  while (true) {
    // ── beforeLLMCall ───────────────────────────────────────────────────
    await runLLMHook(middlewares, "beforeLLMCall", ctx);
    if (ctx.abort) break;

    // ── LLM Call ────────────────────────────────────────────────────────
    let response: LLMResponse;
    try {
      const result = await ollama.chat({
        model: ctx.model,
        // @ts-expect-error — system not in ChatRequest types but works at runtime
        system: ctx.systemPrompt,
        messages: ctx.messages,
        tools: ctx.tools,
      });

      response = {
        message: result.message as Message,
        promptTokens: result.prompt_eval_count ?? 0,
        completionTokens: result.eval_count ?? 0,
      };
    } catch (err) {
      // Store the error so ModelFallback (or other middleware) can react
      ctx.metadata.llmError = (err as Error).message;

      // Re-run beforeLLMCall once — gives ModelFallback a chance to swap model
      await runLLMHook(middlewares, "beforeLLMCall", ctx);
      if (ctx.abort) break;

      // Retry with (potentially swapped) model
      const retryResult = await ollama.chat({
        model: ctx.model,
        // @ts-expect-error — system not in ChatRequest types but works at runtime
        system: ctx.systemPrompt,
        messages: ctx.messages,
        tools: ctx.tools,
      });

      response = {
        message: retryResult.message as Message,
        promptTokens: retryResult.prompt_eval_count ?? 0,
        completionTokens: retryResult.eval_count ?? 0,
      };

      delete ctx.metadata.llmError;
    }

    // Push assistant message to history
    ctx.messages.push(response.message);

    // ── afterLLMCall ────────────────────────────────────────────────────
    await runLLMHook(middlewares, "afterLLMCall", ctx, response);
    if (ctx.abort) break;

    // ── No tool calls → agent is done reasoning ─────────────────────────
    const toolCalls = response.message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    // ── Execute each tool call with before/after hooks ──────────────────
    for (const tc of toolCalls) {
      const { name, arguments: args } = tc.function;
      const toolCallCtx: ToolCallContext = {
        name,
        args: args as Record<string, string>,
        result: "",
      };

      // beforeToolExecution
      await runToolHook(middlewares, "beforeToolExecution", ctx, toolCallCtx);
      if (ctx.abort) break;

      // Execute the tool
      toolCallCtx.result = ctx.executeTool(name, toolCallCtx.args);

      // afterToolExecution — middleware can mutate toolCallCtx.result
      await runToolHook(middlewares, "afterToolExecution", ctx, toolCallCtx);
      if (ctx.abort) break;

      // Push the (potentially modified) result to message history
      ctx.messages.push({
        role: "tool",
        content: toolCallCtx.result,
      });
    }

    if (ctx.abort) break;
  }

  // ── afterAgentLoop ────────────────────────────────────────────────────
  await runHook(middlewares, "afterAgentLoop", ctx);

  if (ctx.abort) {
    return buildAbortResult(ctx);
  }

  return { messages: ctx.messages, metadata: ctx.metadata };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAbortResult(ctx: AgentContext): AgentResult {
  // If middleware set a final message, append it as an assistant response
  if (ctx.abort?.finalMessage) {
    ctx.messages.push({
      role: "assistant",
      content: ctx.abort.finalMessage,
    });
  }
  return { messages: ctx.messages, metadata: ctx.metadata };
}
