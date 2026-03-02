// ─── Middleware Pipeline Evals ────────────────────────────────────────────────
//
// Tests that middleware correctly intercepts and modifies agent behavior:
//   1. PII redaction — sensitive data is masked in tool results
//   2. Middleware ordering — order determines whether logging sees PII
//   3. Token budget — agent stops when budget is exceeded
//   4. Tool retry — failing tools are retried with backoff
//   5. No middleware — agent works correctly with empty middleware array

import { evalite, createScorer } from "evalite";
import { runAgentWithMiddleware } from "../agent.js";
import { tools, executeTool } from "../tools.js";
import { MODEL } from "../../shared/config.js";
import { HOTEL_SYSTEM_PROMPT } from "../../shared/prompts.js";
import { lastAssistantMessage } from "../../shared/eval-utils.js";
import {
  createPIIRedactionMiddleware,
  createLoggingMiddleware,
  createTokenBudgetMiddleware,
  createToolRetryMiddleware,
} from "../middlewares.js";
import type { AgentConfig, AgentResult } from "../agent.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    model: MODEL,
    systemPrompt: HOTEL_SYSTEM_PROMPT,
    tools,
    executeTool,
    ...overrides,
  };
}

// ─── 1. PII Redaction ────────────────────────────────────────────────────────
//
// When PIIRedactionMiddleware is active, email and phone numbers in tool
// results should be replaced with [EMAIL REDACTED] / [PHONE REDACTED].

evalite("Middleware — PII redaction masks sensitive data", {
  data: async () => [
    {
      input: "Look up John Smith's contact information.",
    },
  ],
  task: async (input) => {
    const result = await runAgentWithMiddleware(input, [], {
      ...makeConfig(),
      middlewares: [createPIIRedactionMiddleware()],
    });
    return result;
  },
  scorers: [
    createScorer<string, AgentResult>({
      name: "No raw email in messages",
      scorer: ({ output }) => {
        const allContent = output.messages.map((m) => m.content).join(" ");
        return allContent.includes("@example.com") || allContent.includes("@corporate.net") ? 0 : 1;
      },
    }),
    createScorer<string, AgentResult>({
      name: "No raw phone in messages",
      scorer: ({ output }) => {
        const allContent = output.messages.map((m) => m.content).join(" ");
        // Check for the specific mock phone numbers
        return allContent.includes("555-123-4567") || allContent.includes("555.987.6543") ? 0 : 1;
      },
    }),
    createScorer<string, AgentResult>({
      name: "Redaction markers present",
      scorer: ({ output }) => {
        const toolMessages = output.messages.filter((m) => m.role === "tool").map((m) => m.content);
        const allToolContent = toolMessages.join(" ");
        return allToolContent.includes("[EMAIL REDACTED]") ||
          allToolContent.includes("[PHONE REDACTED]")
          ? 1
          : 0;
      },
    }),
    createScorer<string, AgentResult>({
      name: "PII redaction count tracked",
      scorer: ({ output }) => {
        const count = output.metadata.piiRedactions as number;
        return count > 0 ? 1 : 0;
      },
    }),
  ],
});

// ─── 2. Middleware Ordering ──────────────────────────────────────────────────
//
// With [PIIRedaction, Logging]: logging sees redacted data.
// With [Logging, PIIRedaction]: logging sees raw PII.
// We capture console.log output to verify.

evalite("Middleware — ordering affects logging visibility", {
  data: async () => [
    {
      input: "Look up Alice Johnson's contact details.",
    },
  ],
  task: async (input) => {
    const logs: string[][] = [[], []];

    // Run 1: PII first, then Logging (safe)
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs[0].push(args.join(" "));
    await runAgentWithMiddleware(input, [], {
      ...makeConfig(),
      middlewares: [createPIIRedactionMiddleware(), createLoggingMiddleware()],
    });
    console.log = origLog;

    // Run 2: Logging first, then PII (unsafe)
    console.log = (...args: unknown[]) => logs[1].push(args.join(" "));
    await runAgentWithMiddleware(input, [], {
      ...makeConfig(),
      middlewares: [createLoggingMiddleware(), createPIIRedactionMiddleware()],
    });
    console.log = origLog;

    return logs;
  },
  scorers: [
    createScorer<string, string[][]>({
      name: "Safe order: logs contain redacted markers",
      scorer: ({ output }) => {
        const safeLog = output[0].join(" ");
        return safeLog.includes("[EMAIL REDACTED]") || safeLog.includes("[PHONE REDACTED]") ? 1 : 0;
      },
    }),
    createScorer<string, string[][]>({
      name: "Unsafe order: logs contain raw PII",
      scorer: ({ output }) => {
        const unsafeLog = output[1].join(" ");
        // The unsafe ordering should show raw emails/phones in logs
        return unsafeLog.includes("@") || unsafeLog.includes("555") ? 1 : 0;
      },
    }),
  ],
});

// ─── 3. Token Budget ─────────────────────────────────────────────────────────
//
// With a very low token budget, the agent should abort early.

evalite("Middleware — token budget stops agent", {
  data: async () => [
    {
      input: "I need a suite from 2026-06-01 to 2026-06-10. My name is Test User. Please book it.",
    },
  ],
  task: async (input) => {
    const result = await runAgentWithMiddleware(input, [], {
      ...makeConfig(),
      // Extremely low budget — should trigger after first LLM call
      middlewares: [createTokenBudgetMiddleware(50)],
    });
    return result;
  },
  scorers: [
    createScorer<string, AgentResult>({
      name: "Agent aborted with budget message",
      scorer: ({ output }) => {
        const finalMsg = lastAssistantMessage(output.messages);
        return finalMsg.includes("token") ||
          finalMsg.includes("budget") ||
          finalMsg.includes("limit")
          ? 1
          : 0;
      },
    }),
    createScorer<string, AgentResult>({
      name: "Token count tracked in metadata",
      scorer: ({ output }) => {
        return typeof output.metadata.totalTokens === "number" && output.metadata.totalTokens > 0
          ? 1
          : 0;
      },
    }),
  ],
});

// ─── 4. Tool Retry ───────────────────────────────────────────────────────────
//
// A mock executeTool that fails once then succeeds should trigger retry.

evalite("Middleware — tool retry recovers from transient errors", {
  data: async () => [{ input: "Check rooms from 2026-04-01 to 2026-04-03" }],
  task: async (input) => {
    let callCount = 0;
    const flakeyExecuteTool = (name: string, args: Record<string, string>) => {
      if (name === "check_availability" && callCount === 0) {
        callCount++;
        return JSON.stringify({ error: "temporary database connection error" });
      }
      callCount++;
      return executeTool(name, args);
    };

    const result = await runAgentWithMiddleware(input, [], {
      ...makeConfig(),
      executeTool: flakeyExecuteTool,
      middlewares: [createToolRetryMiddleware(2, 10)],
    });
    return { result, callCount };
  },
  scorers: [
    createScorer<string, { result: AgentResult; callCount: number }>({
      name: "Tool was retried",
      scorer: ({ output }) => {
        const retries = output.result.metadata.toolRetries as number;
        return retries > 0 ? 1 : 0;
      },
    }),
    createScorer<string, { result: AgentResult; callCount: number }>({
      name: "Tool eventually succeeded",
      scorer: ({ output }) => {
        // The tool result in messages should contain availability data, not an error
        const toolMessages = output.result.messages.filter((m) => m.role === "tool");
        const hasSuccess = toolMessages.some((m) => {
          try {
            const parsed = JSON.parse(m.content);
            return parsed.available === true;
          } catch {
            return false;
          }
        });
        return hasSuccess ? 1 : 0;
      },
    }),
  ],
});

// ─── 5. No Middleware ────────────────────────────────────────────────────────
//
// With an empty middleware array, the pipeline runner behaves like vanilla ReAct.

evalite("Middleware — no middleware produces valid output", {
  data: async () => [
    {
      input: "What rooms are available from 2026-05-01 to 2026-05-03?",
    },
  ],
  task: async (input) => {
    const result = await runAgentWithMiddleware(input, [], {
      ...makeConfig(),
      middlewares: [],
    });
    return result;
  },
  scorers: [
    createScorer<string, AgentResult>({
      name: "Agent produced a response",
      scorer: ({ output }) => {
        const response = lastAssistantMessage(output.messages);
        return response.length > 0 ? 1 : 0;
      },
    }),
    createScorer<string, AgentResult>({
      name: "Metadata is empty (no middleware ran)",
      scorer: ({ output }) => {
        return Object.keys(output.metadata).length === 0 ? 1 : 0;
      },
    }),
  ],
});
