import type { Message, ToolDefinition } from "../shared/types.js";

// ─── Middleware Types ────────────────────────────────────────────────────────
//
// The middleware interface defines 6 hook points — the natural interception
// points in an agent execution loop. Each middleware implements only the hooks
// it needs; the pipeline runner skips undefined hooks.
//
// All hooks run sequentially in array order (first middleware first).
// This is the "waterfall" model — simpler than the "onion" model where
// after-hooks run in reverse. The README discusses the tradeoff.

export interface LLMResponse {
  message: Message;
  promptTokens: number;
  completionTokens: number;
}

export interface ToolCallContext {
  name: string;
  args: Record<string, string>;
  result: string; // mutable — middleware can modify after execution
}

export interface AgentContext {
  messages: Message[];
  model: string; // mutable — ModelFallback can swap it
  tools: ToolDefinition[];
  systemPrompt: string;
  executeTool: (name: string, args: Record<string, string>) => string;
  metadata: Record<string, unknown>; // cross-middleware data sharing
  abort?: { reason: string; finalMessage?: string };
}

export interface Middleware {
  name: string;

  // Lifecycle (once per agent turn)
  beforeAgentLoop?(ctx: AgentContext): Promise<void>;
  afterAgentLoop?(ctx: AgentContext): Promise<void>;

  // Per-LLM-call
  beforeLLMCall?(ctx: AgentContext): Promise<void>;
  afterLLMCall?(ctx: AgentContext, response: LLMResponse): Promise<void>;

  // Per-tool-call
  beforeToolExecution?(ctx: AgentContext, toolCall: ToolCallContext): Promise<void>;
  afterToolExecution?(ctx: AgentContext, toolCall: ToolCallContext): Promise<void>;
}

// ─── Pipeline Execution ──────────────────────────────────────────────────────
//
// These helpers run a specific hook across all middleware in order.
// If any middleware sets ctx.abort, remaining middleware are skipped.

export async function runHook(
  middlewares: Middleware[],
  hook: "beforeAgentLoop" | "afterAgentLoop",
  ctx: AgentContext,
): Promise<void> {
  for (const mw of middlewares) {
    if (ctx.abort) break;
    await mw[hook]?.(ctx);
  }
}

export async function runLLMHook(
  middlewares: Middleware[],
  hook: "beforeLLMCall" | "afterLLMCall",
  ctx: AgentContext,
  response?: LLMResponse,
): Promise<void> {
  for (const mw of middlewares) {
    if (ctx.abort) break;
    if (hook === "afterLLMCall" && response) {
      await mw.afterLLMCall?.(ctx, response);
    } else {
      await mw.beforeLLMCall?.(ctx);
    }
  }
}

export async function runToolHook(
  middlewares: Middleware[],
  hook: "beforeToolExecution" | "afterToolExecution",
  ctx: AgentContext,
  toolCall: ToolCallContext,
): Promise<void> {
  for (const mw of middlewares) {
    if (ctx.abort) break;
    await mw[hook]?.(ctx, toolCall);
  }
}
