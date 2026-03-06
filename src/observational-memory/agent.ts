// ─── Observational Memory Agent ──────────────────────────────────────────────
//
// ReAct loop with a two-block context window:
//
//   ┌──────────────────────────────┐
//   │  Block 1: OBSERVATIONS       │  ← Dense, dated observations
//   │  (compressed by Observer,    │     Pruned by Reflector
//   │   stable prefix)             │
//   ├──────────────────────────────┤
//   │  Block 2: RAW MESSAGES       │  ← Recent uncompressed messages
//   │  (appended each turn,        │     Awaiting observation
//   │   consumed by Observer)      │
//   └──────────────────────────────┘
//
// The Observer fires when raw messages exceed OBSERVER_TOKEN_THRESHOLD.
// The Reflector fires when observations exceed REFLECTOR_TOKEN_THRESHOLD.
//
// Two modes:
//   "observe"    — full observational memory (Observer + Reflector)
//   "no-observe" — baseline: raw messages only, truncated when too long

import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { estimateTokens, estimateMessageTokens } from "./token-counter.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import { runObserver } from "./observer.js";
import { runReflector } from "./reflector.js";

// ─── Configuration ──────────────────────────────────────────────────────────
//
// Thresholds are set low for local Ollama models (small context windows).
// In production with cloud models, these would be 30K+ and 40K+.

export const OBSERVER_TOKEN_THRESHOLD = 1500; // trigger Observer when raw messages exceed this
export const REFLECTOR_TOKEN_THRESHOLD = 2000; // trigger Reflector when observations exceed this
const BASELINE_TRUNCATION_THRESHOLD = 2500; // for no-observe mode: truncate oldest messages
const MAX_ITERATIONS = 10;

// ─── Types ──────────────────────────────────────────────────────────────────

export type AgentMode = "observe" | "no-observe";

export interface AgentStats {
  llmCalls: number;
  toolCalls: number;
  observerTriggered: boolean;
  reflectorTriggered: boolean;
  rawMessageTokens: number;
  observationTokens: number;
  totalContextTokens: number;
  mode: AgentMode;
}

export interface AgentResult {
  messages: Message[];
  stats: AgentStats;
}

// ─── Memory State ───────────────────────────────────────────────────────────
//
// Persisted across turns within a session. The observations block grows as
// the Observer compresses messages, and shrinks when the Reflector prunes.

export interface MemoryState {
  observations: string; // Block 1: compressed observations
  rawMessages: Message[]; // Block 2: uncompressed recent messages
}

export function createMemoryState(): MemoryState {
  return { observations: "", rawMessages: [] };
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a helpful recipe assistant. You help users find recipes, plan meals, and adapt dishes to their dietary needs and preferences.

You have access to tools to search recipes, get details, and find ingredient substitutions. Use them to provide personalized recommendations.

When responding:
- Consider the user's dietary restrictions, preferences, and cooking skill level
- Suggest specific recipes and explain why they're a good fit
- Offer substitutions when the user has restrictions or allergies
- Be conversational and helpful`;

function buildSystemPrompt(observations: string): string {
  if (!observations) return BASE_SYSTEM_PROMPT;

  return `${BASE_SYSTEM_PROMPT}

## What You Know About This User
The following observations have been gathered from your previous conversations. Use them naturally to personalize your recommendations — don't explicitly mention that you're reading from a memory log.

${observations}`;
}

// ─── Agent ──────────────────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  memory: MemoryState,
  mode: AgentMode,
): Promise<AgentResult> {
  const stats: AgentStats = {
    llmCalls: 0,
    toolCalls: 0,
    observerTriggered: false,
    reflectorTriggered: false,
    rawMessageTokens: 0,
    observationTokens: 0,
    totalContextTokens: 0,
    mode,
  };

  const today = new Date().toISOString().split("T")[0]!;

  // Add the user message to raw messages
  memory.rawMessages.push({ role: "user", content: userMessage });

  // ── Phase 1: Check Observer threshold ─────────────────────────────────
  //
  // If raw messages exceed the threshold, run the Observer to compress them
  // into observations before the main LLM call.

  if (mode === "observe") {
    const rawTokens = estimateMessageTokens(memory.rawMessages);

    if (rawTokens > OBSERVER_TOKEN_THRESHOLD) {
      console.log(
        `\n  👁️  Observer triggered (${rawTokens} tokens > ${OBSERVER_TOKEN_THRESHOLD} threshold)`,
      );

      const result = await runObserver(memory.rawMessages, today);
      stats.llmCalls += 1;
      stats.observerTriggered = true;

      // Append new observations to the observation block
      if (memory.observations) {
        memory.observations = `${memory.observations}\n\n${result.observations}`;
      } else {
        memory.observations = result.observations;
      }

      // Clear consumed messages — keep only the latest user message
      // so the agent has immediate context for this turn
      memory.rawMessages = [{ role: "user", content: userMessage }];

      console.log(`     Compressed ${result.messagesConsumed} messages → observations`);
      console.log(`     Observation preview: ${result.observations.slice(0, 120)}...`);
    }

    // ── Phase 2: Check Reflector threshold ──────────────────────────────
    //
    // If observations exceed the threshold, run the Reflector to prune them.

    const obsTokens = estimateTokens(memory.observations);

    if (obsTokens > REFLECTOR_TOKEN_THRESHOLD) {
      console.log(
        `\n  🔄 Reflector triggered (${obsTokens} tokens > ${REFLECTOR_TOKEN_THRESHOLD} threshold)`,
      );

      const beforeLines = memory.observations.split("\n").filter((l) => l.startsWith("- ")).length;
      const result = await runReflector(memory.observations);
      stats.llmCalls += 1;
      stats.reflectorTriggered = true;

      const afterLines = result.observations.split("\n").filter((l) => l.startsWith("- ")).length;
      memory.observations = result.observations;

      console.log(`     Condensed ${beforeLines} → ${afterLines} observations`);
    }
  }

  // ── Baseline truncation (no-observe mode only) ─────────────────────────
  //
  // Without observational memory, the only option is to drop old messages
  // when context gets too large. This is the failure mode OM solves.

  if (mode === "no-observe") {
    const rawTokens = estimateMessageTokens(memory.rawMessages);
    if (rawTokens > BASELINE_TRUNCATION_THRESHOLD) {
      const before = memory.rawMessages.length;
      // Drop oldest messages (keeping the latest user message at minimum)
      while (
        memory.rawMessages.length > 2 &&
        estimateMessageTokens(memory.rawMessages) > BASELINE_TRUNCATION_THRESHOLD
      ) {
        memory.rawMessages.shift();
      }
      console.log(
        `\n  ✂️  Truncated: dropped ${before - memory.rawMessages.length} old messages (${rawTokens} → ${estimateMessageTokens(memory.rawMessages)} tokens)`,
      );
    }
  }

  // ── Phase 3: Build context and run ReAct loop ─────────────────────────

  const systemPrompt =
    mode === "observe" ? buildSystemPrompt(memory.observations) : BASE_SYSTEM_PROMPT;

  // The messages sent to the LLM are just the raw (uncompressed) messages.
  // Observations are in the system prompt, not in the message array.
  const llmMessages = [...memory.rawMessages];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    stats.llmCalls += 1;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
      messages: llmMessages,
      tools,
    });

    const assistantMessage = response.message as Message;
    llmMessages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      stats.toolCalls += 1;

      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 120 });

      llmMessages.push({ role: "tool", content: result });
    }
  }

  // Update raw messages with the full exchange from this turn
  memory.rawMessages = llmMessages;

  // Compute stats
  stats.rawMessageTokens = estimateMessageTokens(memory.rawMessages);
  stats.observationTokens = estimateTokens(memory.observations);
  stats.totalContextTokens = estimateTokens(systemPrompt) + stats.rawMessageTokens;

  return { messages: llmMessages, stats };
}
