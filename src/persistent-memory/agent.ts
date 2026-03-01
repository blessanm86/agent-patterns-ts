// ─── Persistent Memory Agent ────────────────────────────────────────────────
//
// Modified ReAct loop with three phases:
//   1. Pre-loop  — inject stored memories into the system prompt
//   2. ReAct     — standard while(true) tool-calling loop
//   3. Post-loop — extract new memories, process forget requests,
//                  privacy-check, deduplicate, and store
//
// Supports two modes:
//   "with-memory"  — full memory lifecycle (inject + extract)
//   "no-memory"    — standard ReAct loop, no memory injection or extraction

import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import { PersistentMemoryStore } from "./memory-store.js";
import { extractMemories } from "./memory-extractor.js";
import { checkForPII } from "./privacy.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentMode = "with-memory" | "no-memory";

export interface AgentStats {
  llmCalls: number;
  toolCalls: number;
  memoriesInjected: number;
  memoriesExtracted: number;
  memoriesForgotten: number;
  privacyBlocked: number;
  mode: AgentMode;
}

export interface AgentResult {
  messages: Message[];
  stats: AgentStats;
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a helpful restaurant recommendation assistant for New York City. You help users find restaurants based on their preferences, dietary restrictions, and location.

You have access to tools to search restaurants, get details, and read reviews. Use them to provide personalized recommendations.

When responding:
- Consider the user's dietary restrictions, cuisine preferences, and location
- Mention specific restaurant names and why they're a good fit
- Be conversational and helpful
- If you have memories about the user, reference them naturally (e.g., "Since you're vegetarian..." not "According to my memory database...")`;

function buildSystemPrompt(memoryBlock: string): string {
  if (!memoryBlock) return BASE_SYSTEM_PROMPT;
  return `${BASE_SYSTEM_PROMPT}\n\n${memoryBlock}`;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  history: Message[],
  mode: AgentMode,
  memoryStore?: PersistentMemoryStore,
): Promise<AgentResult> {
  const stats: AgentStats = {
    llmCalls: 0,
    toolCalls: 0,
    memoriesInjected: 0,
    memoriesExtracted: 0,
    memoriesForgotten: 0,
    privacyBlocked: 0,
    mode,
  };

  // ── Phase 1: Pre-loop — Inject memories into system prompt ─────────────

  let systemPrompt = BASE_SYSTEM_PROMPT;

  if (mode === "with-memory" && memoryStore) {
    const memoryBlock = memoryStore.toPromptString();
    systemPrompt = buildSystemPrompt(memoryBlock);
    if (memoryBlock) {
      // Count the number of "- " lines in the memory block
      stats.memoriesInjected = (memoryBlock.match(/^- /gm) ?? []).length;
      console.log(`\n  🧠 Injected ${stats.memoriesInjected} memories into system prompt`);
    }
  }

  // ── Phase 2: ReAct loop — Standard tool-calling loop ──────────────────

  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  while (true) {
    stats.llmCalls += 1;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      stats.toolCalls += 1;

      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);

      messages.push({ role: "tool", content: result });
    }
  }

  // ── Phase 3: Post-loop — Extract and store memories ────────────────────

  if (mode === "with-memory" && memoryStore) {
    const existingContents = memoryStore.allFacts.map((f) => f.content);
    const extraction = await extractMemories(messages, existingContents);
    stats.llmCalls += 1;

    if (extraction.error) {
      console.log(`\n  ⚠️  Memory extraction error: ${extraction.error}`);
    } else if (extraction.result) {
      // Process forget requests
      for (const forgetText of extraction.result.forgetRequests) {
        const removed = memoryStore.forgetByContent(forgetText);
        stats.memoriesForgotten += removed.length;
        for (const fact of removed) {
          console.log(`\n  🗑️  Forgot: "${fact.content}"`);
        }
      }

      // Process new facts
      for (const fact of extraction.result.facts) {
        // Privacy check
        const piiCheck = checkForPII(fact.content);
        if (!piiCheck.isSafe) {
          stats.privacyBlocked += 1;
          console.log(
            `\n  🔒 Blocked (PII: ${piiCheck.flaggedPatterns.join(", ")}): "${fact.content}"`,
          );
          continue;
        }

        // Dedup check
        const existing = memoryStore.deduplicate(fact.content, fact.category);
        if (existing) {
          console.log(
            `\n  🔄 Duplicate skipped: "${fact.content}" (matches "${existing.content}")`,
          );
          continue;
        }

        // Store
        const stored = memoryStore.addFact(fact.content, fact.category, fact.importance);
        stats.memoriesExtracted += 1;
        console.log(
          `\n  💾 Stored: "${stored.content}" [${stored.category}, importance: ${stored.importance}]`,
        );
      }
    }
  }

  return { messages, stats };
}
