// ─── Post-Conversation Metadata Evals ─────────────────────────────────────────
//
// 4 groups:
//   1. Message filtering (deterministic) — filterForMetadata strips tool messages
//   2. Metadata schema (LLM-dependent) — generateMetadata produces valid schema
//   3. Category classification (LLM-dependent) — correct category for billing/technical
//   4. Mode comparison (LLM-dependent) — with-metadata has 1 more LLM call

import { evalite, createScorer } from "evalite";
import { filterForMetadata, generateMetadata, type MetadataResult } from "../metadata.js";
import { runAgent, type AgentStats } from "../agent.js";
import type { Message } from "../../shared/types.js";

// ─── Group 1: Message Filtering (deterministic) ─────────────────────────────

evalite("Filter — strips tool messages, preserves user + assistant text", {
  data: async () => [
    {
      input: [
        { role: "user", content: "Look up Acme Corp" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "lookup_account", arguments: { query: "Acme Corp" } } }],
        },
        { role: "tool", content: '{"found": true, "account": {"id": "ACC-1001"}}' },
        { role: "assistant", content: "I found the Acme Corp account." },
        { role: "user", content: "What plan are they on?" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { function: { name: "check_subscription", arguments: { account_id: "ACC-1001" } } },
          ],
        },
        { role: "tool", content: '{"found": true, "subscription": {"plan": "Business"}}' },
        { role: "assistant", content: "They are on the Business plan." },
      ] as Message[],
    },
  ],
  task: async (input) => filterForMetadata(input),
  scorers: [
    createScorer<Message[], Message[]>({
      name: "no tool messages remain",
      scorer: ({ output }) => (output.every((m) => m.role !== "tool") ? 1 : 0),
    }),
    createScorer<Message[], Message[]>({
      name: "no tool-call-only assistant messages",
      scorer: ({ output }) => {
        const toolCallOnly = output.filter(
          (m) =>
            m.role === "assistant" &&
            m.tool_calls &&
            m.tool_calls.length > 0 &&
            (!m.content || m.content.trim() === ""),
        );
        return toolCallOnly.length === 0 ? 1 : 0;
      },
    }),
    createScorer<Message[], Message[]>({
      name: "preserves user messages",
      scorer: ({ output }) => (output.filter((m) => m.role === "user").length === 2 ? 1 : 0),
    }),
    createScorer<Message[], Message[]>({
      name: "preserves assistant text messages",
      scorer: ({ output }) => (output.filter((m) => m.role === "assistant").length === 2 ? 1 : 0),
    }),
    createScorer<Message[], Message[]>({
      name: "4 messages total (2 user + 2 assistant text)",
      scorer: ({ output }) => (output.length === 4 ? 1 : 0),
    }),
  ],
});

evalite("Filter — empty history returns empty", {
  data: async () => [{ input: [] as Message[] }],
  task: async (input) => filterForMetadata(input),
  scorers: [
    createScorer<Message[], Message[]>({
      name: "returns empty array",
      scorer: ({ output }) => (output.length === 0 ? 1 : 0),
    }),
  ],
});

// ─── Group 2: Metadata Schema (LLM-dependent) ───────────────────────────────

evalite("Metadata — produces valid schema for billing conversation", {
  data: async () => [
    {
      input: [
        {
          role: "user",
          content: "I need to understand my bill. Can you look up the account for Acme Corp?",
        },
        {
          role: "assistant",
          content:
            "I found the Acme Corp account (ACC-1001). They're on the Business plan at $299/month, billed monthly. The next billing date is April 1st, 2026. The payment method on file is a Visa ending in 4242.",
        },
      ] as Message[],
    },
  ],
  task: async (input) => generateMetadata(input),
  scorers: [
    createScorer<Message[], MetadataResult>({
      name: "no error",
      scorer: ({ output }) => (output.error === null ? 1 : 0),
    }),
    createScorer<Message[], MetadataResult>({
      name: "metadata is not null",
      scorer: ({ output }) => (output.metadata !== null ? 1 : 0),
    }),
    createScorer<Message[], MetadataResult>({
      name: "threadName is non-empty",
      scorer: ({ output }) => (output.metadata && output.metadata.threadName.length > 0 ? 1 : 0),
    }),
    createScorer<Message[], MetadataResult>({
      name: "1-3 suggestions",
      scorer: ({ output }) => {
        if (!output.metadata) return 0;
        const len = output.metadata.suggestions.length;
        return len >= 1 && len <= 3 ? 1 : 0;
      },
    }),
    createScorer<Message[], MetadataResult>({
      name: "suggestions have label and prompt",
      scorer: ({ output }) => {
        if (!output.metadata) return 0;
        return output.metadata.suggestions.every((s) => s.label.length > 0 && s.prompt.length > 0)
          ? 1
          : 0;
      },
    }),
    createScorer<Message[], MetadataResult>({
      name: "category is valid enum",
      scorer: ({ output }) => {
        if (!output.metadata) return 0;
        return ["billing", "technical", "feature-request", "account", "general"].includes(
          output.metadata.category,
        )
          ? 1
          : 0;
      },
    }),
    createScorer<Message[], MetadataResult>({
      name: "securityFlag is valid enum",
      scorer: ({ output }) => {
        if (!output.metadata) return 0;
        return ["none", "pii-detected", "prompt-injection", "suspicious"].includes(
          output.metadata.securityFlag,
        )
          ? 1
          : 0;
      },
    }),
  ],
});

// ─── Group 3: Category Classification (LLM-dependent) ───────────────────────

evalite("Category — billing conversation classified as billing", {
  data: async () => [
    {
      input: [
        {
          role: "user",
          content: "I want to upgrade my plan from Starter to Business. How much will it cost?",
        },
        {
          role: "assistant",
          content:
            "The Business plan is $299/month. Since you're currently on the Starter plan at $29/month, upgrading mid-cycle would be prorated.",
        },
      ] as Message[],
    },
  ],
  task: async (input) => generateMetadata(input),
  scorers: [
    createScorer<Message[], MetadataResult>({
      name: "category is billing",
      scorer: ({ output }) => (output.metadata?.category === "billing" ? 1 : 0),
    }),
  ],
});

evalite("Category — technical conversation classified as technical", {
  data: async () => [
    {
      input: [
        {
          role: "user",
          content: "I'm getting 502 errors when calling the API. Is there an outage?",
        },
        {
          role: "assistant",
          content:
            "Yes, we have a known incident INC-401: Intermittent 502 errors on API Gateway. Our team is investigating. The issue started on Feb 28th and was last updated this morning.",
        },
      ] as Message[],
    },
  ],
  task: async (input) => generateMetadata(input),
  scorers: [
    createScorer<Message[], MetadataResult>({
      name: "category is technical",
      scorer: ({ output }) => (output.metadata?.category === "technical" ? 1 : 0),
    }),
  ],
});

// ─── Group 4: Mode Comparison (LLM-dependent) ───────────────────────────────

type ComparisonResult = { withMeta: AgentStats; noMeta: AgentStats };

evalite("Comparison — with-metadata has 1 more LLM call", {
  data: async () => [{ input: "Are there any known issues affecting CloudStack right now?" }],
  task: async (input) => {
    const withMeta = await runAgent(input, [], "with-metadata");
    const noMeta = await runAgent(input, [], "no-metadata");
    return { withMeta: withMeta.stats, noMeta: noMeta.stats };
  },
  scorers: [
    createScorer<string, ComparisonResult>({
      name: "with-metadata has exactly 1 more LLM call",
      scorer: ({ output }) => (output.withMeta.llmCalls === output.noMeta.llmCalls + 1 ? 1 : 0),
    }),
    createScorer<string, ComparisonResult>({
      name: "with-metadata produces metadata",
      scorer: ({ output }) => (output.withMeta.metadataResult?.metadata !== null ? 1 : 0),
    }),
    createScorer<string, ComparisonResult>({
      name: "no-metadata produces null metadataResult",
      scorer: ({ output }) => (output.noMeta.metadataResult === null ? 1 : 0),
    }),
  ],
});
