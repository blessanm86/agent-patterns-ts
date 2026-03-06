// ─── Dependency Injection Evals ──────────────────────────────────────────────
//
// Tests that the DI pattern works correctly:
//   1. User scoping — tools only return data for the injected user
//   2. Context invisible — RunContext never appears in LLM messages
//   3. Different deps → different behavior — same agent, different injected user
//   4. Tier-dependent behavior — loyalty points reflect the injected user's tier
//   5. Logger captures tool activity — recording logger has entries after tool use

import { evalite, createScorer } from "evalite";
import { runAgent } from "../agent.js";
import {
  createRunContext,
  createMockDatabase,
  createRecordingLogger,
  type Deps,
  type UserInfo,
} from "../context.js";
import type { Message } from "../../shared/types.js";
import { lastAssistantMessage } from "../../shared/eval-utils.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDeps(user: UserInfo, logger = createRecordingLogger()): Deps {
  return { db: createMockDatabase(), user, logger };
}

const ALICE: UserInfo = { id: "user-alice", name: "Alice Chen", tier: "standard" };
const BOB: UserInfo = { id: "user-bob", name: "Bob Martinez", tier: "vip" };

// ─── 1. User Scoping ───────────────────────────────────────────────────────
//
// Alice should see her orders but not Bob's.

evalite("DI -- user scoping: Alice sees only her orders", {
  data: async () => [{ input: "Show me my recent orders" }],
  task: async (input) => {
    const ctx = createRunContext(makeDeps(ALICE));
    const messages = await runAgent(input, [], ctx);
    return { messages, ctx };
  },
  scorers: [
    createScorer<string, { messages: Message[]; ctx: ReturnType<typeof createRunContext> }>({
      name: "Response mentions Alice's order IDs",
      scorer: ({ output }) => {
        const response = lastAssistantMessage(output.messages);
        return response.includes("ORD-1001") || response.includes("ORD-1002") ? 1 : 0;
      },
    }),
    createScorer<string, { messages: Message[]; ctx: ReturnType<typeof createRunContext> }>({
      name: "Response does NOT mention Bob's order IDs",
      scorer: ({ output }) => {
        const allContent = output.messages.map((m) => m.content).join(" ");
        return allContent.includes("ORD-2001") || allContent.includes("ORD-2002") ? 0 : 1;
      },
    }),
  ],
});

// ─── 2. Context Invisible to LLM ───────────────────────────────────────────
//
// The RunContext (runId, deps object, logger) should never appear in messages.

evalite("DI -- context invisible: RunContext not in LLM messages", {
  data: async () => [{ input: "What orders do I have?" }],
  task: async (input) => {
    const ctx = createRunContext(makeDeps(ALICE));
    const messages = await runAgent(input, [], ctx);
    return { messages, runId: ctx.runId };
  },
  scorers: [
    createScorer<string, { messages: Message[]; runId: string }>({
      name: "Run ID not in any message",
      scorer: ({ output }) => {
        const allContent = output.messages.map((m) => m.content).join(" ");
        return allContent.includes(output.runId) ? 0 : 1;
      },
    }),
    createScorer<string, { messages: Message[]; runId: string }>({
      name: "No 'user-alice' literal in messages",
      scorer: ({ output }) => {
        // The user ID is an internal identifier — only the name should appear
        const allContent = output.messages.map((m) => m.content).join(" ");
        return allContent.includes("user-alice") ? 0 : 1;
      },
    }),
  ],
});

// ─── 3. Different Deps → Different Behavior ────────────────────────────────
//
// Same prompt, different injected user → different orders returned.

evalite("DI -- same agent, different user: Bob sees his own orders", {
  data: async () => [{ input: "Show me my recent orders" }],
  task: async (input) => {
    const ctx = createRunContext(makeDeps(BOB));
    const messages = await runAgent(input, [], ctx);
    return messages;
  },
  scorers: [
    createScorer<string, Message[]>({
      name: "Response mentions Bob's order IDs",
      scorer: ({ output }) => {
        const response = lastAssistantMessage(output);
        return response.includes("ORD-2001") || response.includes("ORD-2002") ? 1 : 0;
      },
    }),
    createScorer<string, Message[]>({
      name: "Response does NOT mention Alice's order IDs",
      scorer: ({ output }) => {
        const allContent = output.map((m) => m.content).join(" ");
        return allContent.includes("ORD-1001") || allContent.includes("ORD-1002") ? 0 : 1;
      },
    }),
  ],
});

// ─── 4. Tier-Dependent Behavior ─────────────────────────────────────────────
//
// VIP Bob should get a 3x multiplier on loyalty points.

evalite("DI -- tier affects loyalty points: VIP gets 3x multiplier", {
  data: async () => [{ input: "How many loyalty points do I have?" }],
  task: async (input) => {
    const ctx = createRunContext(makeDeps(BOB));
    const messages = await runAgent(input, [], ctx);
    return messages;
  },
  scorers: [
    createScorer<string, Message[]>({
      name: "Response mentions VIP or 3x",
      scorer: ({ output }) => {
        const response = lastAssistantMessage(output).toLowerCase();
        return response.includes("vip") || response.includes("3x") || response.includes("triple")
          ? 1
          : 0;
      },
    }),
    createScorer<string, Message[]>({
      name: "Tool result contains 3x multiplier",
      scorer: ({ output }) => {
        const toolMessages = output.filter((m) => m.role === "tool");
        return toolMessages.some((m) => m.content.includes('"3x"')) ? 1 : 0;
      },
    }),
  ],
});

// ─── 5. Recording Logger Captures Activity ──────────────────────────────────
//
// The recording logger should have entries after tool use — proving DI works.

evalite("DI -- logger injection: recording logger captures tool calls", {
  data: async () => [{ input: "Look up order ORD-1001" }],
  task: async (input) => {
    const logger = createRecordingLogger();
    const ctx = createRunContext(makeDeps(ALICE, logger));
    await runAgent(input, [], ctx);
    return { logEntries: logger.entries, toolCallCount: ctx.toolCallCount };
  },
  scorers: [
    createScorer<string, { logEntries: unknown[]; toolCallCount: number }>({
      name: "Logger has entries",
      scorer: ({ output }) => (output.logEntries.length > 0 ? 1 : 0),
    }),
    createScorer<string, { logEntries: unknown[]; toolCallCount: number }>({
      name: "Tool call count incremented",
      scorer: ({ output }) => (output.toolCallCount > 0 ? 1 : 0),
    }),
  ],
});
