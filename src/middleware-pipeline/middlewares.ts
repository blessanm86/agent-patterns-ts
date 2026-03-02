import type { AgentContext, LLMResponse, Middleware, ToolCallContext } from "./middleware.js";

// ─── TokenBudgetMiddleware ───────────────────────────────────────────────────
//
// Tracks cumulative token usage across LLM calls and aborts the agent
// when the budget is exceeded. Equivalent to the guardrails concept's
// token circuit breaker, but as a composable middleware.

export function createTokenBudgetMiddleware(maxTokens = 6000): Middleware {
  return {
    name: "TokenBudget",

    async beforeAgentLoop(ctx: AgentContext) {
      ctx.metadata.totalTokens = 0;
      ctx.metadata.iterations = 0;
    },

    async afterLLMCall(ctx: AgentContext, response: LLMResponse) {
      const total =
        (ctx.metadata.totalTokens as number) + response.promptTokens + response.completionTokens;
      ctx.metadata.totalTokens = total;
      ctx.metadata.iterations = (ctx.metadata.iterations as number) + 1;

      if (total > maxTokens) {
        ctx.abort = {
          reason: "token-budget-exceeded",
          finalMessage: `I've used ${total.toLocaleString()} tokens (budget: ${maxTokens.toLocaleString()}). Stopping to stay within limits.`,
        };
      }
    },
  };
}

// ─── ToolRetryMiddleware ─────────────────────────────────────────────────────
//
// Retries a tool call when the result contains an "error" field.
// Uses exponential backoff: delay * 2^attempt.

export function createToolRetryMiddleware(maxRetries = 2, baseDelayMs = 100): Middleware {
  return {
    name: "ToolRetry",

    async afterToolExecution(ctx: AgentContext, toolCall: ToolCallContext) {
      let retries = 0;

      while (retries < maxRetries) {
        try {
          const parsed = JSON.parse(toolCall.result);
          if (!parsed.error) break;
        } catch {
          break; // not JSON — can't determine if it's an error
        }

        retries++;
        const delay = baseDelayMs * 2 ** (retries - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Re-execute the tool
        toolCall.result = ctx.executeTool(toolCall.name, toolCall.args);
      }

      if (retries > 0) {
        ctx.metadata.toolRetries = ((ctx.metadata.toolRetries as number) ?? 0) + retries;
      }
    },
  };
}

// ─── PIIRedactionMiddleware ──────────────────────────────────────────────────
//
// Scans tool results for common PII patterns and masks them before
// the result enters the message history. This means the model never
// sees raw PII — it reasons over redacted data.

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, replacement: "[EMAIL REDACTED]" },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: "[PHONE REDACTED]" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN REDACTED]" },
];

export function createPIIRedactionMiddleware(): Middleware {
  return {
    name: "PIIRedaction",

    async beforeAgentLoop(ctx: AgentContext) {
      ctx.metadata.piiRedactions = 0;
    },

    async afterToolExecution(_ctx: AgentContext, toolCall: ToolCallContext) {
      let redacted = toolCall.result;
      let count = 0;

      for (const { pattern, replacement } of PII_PATTERNS) {
        // Reset lastIndex since we're reusing the pattern
        pattern.lastIndex = 0;
        const matches = redacted.match(pattern);
        if (matches) {
          count += matches.length;
          redacted = redacted.replace(pattern, replacement);
        }
      }

      if (count > 0) {
        toolCall.result = redacted;
        _ctx.metadata.piiRedactions = ((_ctx.metadata.piiRedactions as number) ?? 0) + count;
      }
    },
  };
}

// ─── ModelFallbackMiddleware ─────────────────────────────────────────────────
//
// Swaps to a fallback model when the primary model fails. The agent.ts
// pipeline runner stores errors in metadata.llmError and re-runs
// beforeLLMCall, giving this middleware a chance to swap ctx.model.

export function createModelFallbackMiddleware(
  primaryModel: string,
  fallbackModel: string,
): Middleware {
  return {
    name: "ModelFallback",

    async beforeAgentLoop(ctx: AgentContext) {
      ctx.model = primaryModel;
      ctx.metadata.modelFallbackUsed = false;
    },

    async beforeLLMCall(ctx: AgentContext) {
      if (ctx.metadata.llmError) {
        console.log(
          `  ⚠️  Model "${ctx.model}" failed: ${ctx.metadata.llmError}. Falling back to "${fallbackModel}"`,
        );
        ctx.model = fallbackModel;
        ctx.metadata.modelFallbackUsed = true;
      }
    },
  };
}

// ─── LoggingMiddleware ───────────────────────────────────────────────────────
//
// Logs tool calls to the console. Its position in the middleware array
// relative to PIIRedaction determines whether PII appears in logs:
//   [PIIRedaction, Logging]  → logs see redacted data
//   [Logging, PIIRedaction]  → logs see raw PII
//
// This ordering dependency is the key demo for middleware composition.

export function createLoggingMiddleware(): Middleware {
  return {
    name: "Logging",

    async afterToolExecution(_ctx: AgentContext, toolCall: ToolCallContext) {
      const preview =
        toolCall.result.length > 120 ? `${toolCall.result.slice(0, 120)}...` : toolCall.result;
      console.log(`\n  🔧 Tool call: ${toolCall.name}`);
      console.log(`     Args: ${JSON.stringify(toolCall.args, null, 2).replace(/\n/g, "\n     ")}`);
      console.log(`     Result: ${preview}`);
    },
  };
}
