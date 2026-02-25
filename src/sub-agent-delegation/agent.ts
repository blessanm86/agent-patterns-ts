import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import { flightTools, hotelTools, activityTools } from "../multi-agent-routing/tools.js";
import { getProfileByName } from "../multi-agent-routing/profiles.js";
import type { AgentProfile } from "../multi-agent-routing/profiles.js";
import {
  delegationTools,
  executeFlightToolWithPortland,
  executeHotelToolWithPortland,
  executeActivityToolWithPortland,
} from "./tools.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_DEPTH = 2;

// ─── Types ──────────────────────────────────────────────────────────────────

export type DelegationMode = "sequential" | "parallel";

export interface ChildAgentResult {
  agentName: string;
  task: string;
  result: string;
  toolCallCount: number;
  durationMs: number;
  status: "fulfilled" | "rejected";
  error?: string;
}

export interface ParentAgentResult {
  messages: Message[];
  mode: DelegationMode;
  children: ChildAgentResult[];
  totalDurationMs: number;
}

// ─── Child Agent Profiles (Portland-Aware) ──────────────────────────────────
//
// We reuse the profile metadata (name, label, systemPrompt) from
// multi-agent-routing, but swap in Portland-aware dispatchers.

function getChildProfile(agentName: string): AgentProfile {
  const base = getProfileByName(agentName);

  // Override dispatchers with Portland-aware versions
  switch (agentName) {
    case "flight_agent":
      return { ...base, tools: flightTools, executeTool: executeFlightToolWithPortland };
    case "hotel_agent":
      return { ...base, tools: hotelTools, executeTool: executeHotelToolWithPortland };
    case "activity_agent":
      return { ...base, tools: activityTools, executeTool: executeActivityToolWithPortland };
    default:
      return base;
  }
}

// ─── Child Agent ────────────────────────────────────────────────────────────
//
// Runs a scoped ReAct loop with PRISTINE context — fresh messages array,
// no parent history. The child only sees its task and its own tool results.
//
// Context isolation is critical: without it, children inherit the parent's
// growing context ("context cancer"), leading to confused tool calls and
// ballooning token usage.
//
// Returns only the final assistant text — compressed result. The parent
// doesn't need to see the child's internal reasoning.

export async function runChildAgent(
  task: string,
  profile: AgentProfile,
  depth: number,
): Promise<{ result: string; toolCallCount: number }> {
  // Depth guard — belt-and-suspenders with structural guard (children don't have delegation tools)
  if (depth >= MAX_DEPTH) {
    return {
      result: `[Depth limit reached (${depth}/${MAX_DEPTH}). Cannot spawn further child agents.]`,
      toolCallCount: 0,
    };
  }

  // Fresh context — no parent history
  const messages: Message[] = [{ role: "user", content: task }];
  let toolCallCount = 0;

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: profile.systemPrompt,
      messages,
      tools: profile.tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → child is done
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute tools using the profile's scoped dispatcher
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = profile.executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 200 });
      toolCallCount++;

      messages.push({ role: "tool", content: result });
    }
  }

  // Return only the final assistant text (compressed result)
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  return {
    result: lastAssistant?.content ?? "[No response from child agent]",
    toolCallCount,
  };
}

// ─── Delegation Tool Executor ───────────────────────────────────────────────
//
// Bridge between the parent's tool calls and child agent execution.
// Maps delegation tool names to child profiles and constructs tasks.

const DELEGATION_MAP: Record<string, string> = {
  delegate_flight_research: "flight_agent",
  delegate_hotel_research: "hotel_agent",
  delegate_activity_research: "activity_agent",
};

export async function executeDelegationTool(
  name: string,
  args: Record<string, string>,
  depth: number,
): Promise<ChildAgentResult> {
  const agentName = DELEGATION_MAP[name];
  if (!agentName) {
    return {
      agentName: "unknown",
      task: args.task ?? "",
      result: JSON.stringify({ error: `Unknown delegation tool: ${name}` }),
      toolCallCount: 0,
      durationMs: 0,
      status: "rejected",
      error: `Unknown delegation tool: ${name}`,
    };
  }

  const profile = getChildProfile(agentName);
  const task = args.task ?? "";

  console.log(`\n  👶 Spawning child: ${profile.label}`);
  console.log(`     Task: "${task}"`);
  console.log(`     Depth: ${depth + 1}/${MAX_DEPTH}`);

  const start = Date.now();

  try {
    const { result, toolCallCount } = await runChildAgent(task, profile, depth + 1);
    const durationMs = Date.now() - start;

    console.log(`  ✅ ${profile.label} done (${toolCallCount} tools, ${durationMs}ms)`);

    return {
      agentName: profile.name,
      task,
      result,
      toolCallCount,
      durationMs,
      status: "fulfilled",
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = (err as Error).message;

    console.log(`  ❌ ${profile.label} failed: ${error}`);

    return {
      agentName: profile.name,
      task,
      result: JSON.stringify({ error: `Child agent failed: ${error}` }),
      toolCallCount: 0,
      durationMs,
      status: "rejected",
      error,
    };
  }
}

// ─── Parent Agent: Sequential Mode ──────────────────────────────────────────
//
// Standard ReAct loop where the parent calls delegation tools one at a time.
// Natural for the model — it decides what to delegate and when, just like
// calling any other tool. The loop is identical to the basic ReAct loop;
// the only difference is that "tool execution" spawns a child agent.

const PARENT_SYSTEM_PROMPT = `You are a trip planning orchestrator. Your job is to coordinate specialist agents to plan the perfect trip.

IMPORTANT RULES:
- NEVER research flights, hotels, or activities directly — you don't have those tools
- ALWAYS delegate research to specialist agents using your delegation tools
- For multi-domain queries (e.g., "plan a trip"), delegate to ALL relevant specialists
- For single-domain queries (e.g., "find flights"), delegate to just the relevant specialist
- After receiving results from specialists, synthesize them into a unified, helpful response

Your delegation tools:
- delegate_flight_research: Send a task to the flight specialist
- delegate_hotel_research: Send a task to the hotel specialist
- delegate_activity_research: Send a task to the activity specialist

When delegating, provide clear, specific tasks with all necessary details (cities, dates, preferences).
After all delegations complete, combine the results into a coherent itinerary or recommendation.`;

async function runSequentialParent(
  userMessage: string,
  history: Message[],
): Promise<ParentAgentResult> {
  const start = Date.now();
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const children: ChildAgentResult[] = [];

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: PARENT_SYSTEM_PROMPT,
      messages,
      tools: delegationTools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → parent is done
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute delegation tools sequentially
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const childResult = await executeDelegationTool(name, args as Record<string, string>, 0);
      children.push(childResult);

      // Feed child's result back to parent as a tool response
      messages.push({ role: "tool", content: childResult.result });
    }
  }

  return {
    messages,
    mode: "sequential",
    children,
    totalDurationMs: Date.now() - start,
  };
}

// ─── Parent Agent: Parallel Mode ────────────────────────────────────────────
//
// Three-phase pipeline:
// 1. Decompose: LLM call to identify which specialists to invoke (structured JSON)
// 2. Execute: Promise.allSettled() over all children — parallel execution
// 3. Synthesize: LLM call to combine child results into a unified response
//
// This shows the latency reduction: 3 children in parallel take ~1x time vs ~3x.

interface DecomposedTask {
  delegations: Array<{
    tool: string;
    task: string;
  }>;
}

const DECOMPOSE_PROMPT = `You are a trip planning orchestrator. Given the user's request, decide which specialist agents to delegate to.

Available specialists:
- delegate_flight_research: For finding flights between cities
- delegate_hotel_research: For finding hotels and accommodation
- delegate_activity_research: For finding attractions, restaurants, and things to do

Respond with a JSON object listing the delegations needed:
{
  "delegations": [
    { "tool": "delegate_flight_research", "task": "Find flights from Seattle to Portland for March 15, 2025" },
    { "tool": "delegate_hotel_research", "task": "Find hotels in Portland for March 15-17, 2025" }
  ]
}

Rules:
- Include ALL relevant specialists for the query
- For greetings or non-travel questions, return {"delegations": []}
- Write clear, specific task descriptions with all details from the user's message
- Only use the three tool names listed above`;

async function runParallelParent(
  userMessage: string,
  history: Message[],
): Promise<ParentAgentResult> {
  const start = Date.now();
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // Phase 1: Decompose — identify what to delegate
  console.log("\n  📋 Phase 1: Decomposing task...");

  const decomposeMessages: Message[] = [{ role: "user", content: userMessage }];
  const decomposeResponse = await ollama.chat({
    model: MODEL,
    // @ts-expect-error — system not in ChatRequest types but works at runtime
    system: DECOMPOSE_PROMPT,
    messages: decomposeMessages,
    format: "json",
  });

  let decomposed: DecomposedTask;
  try {
    decomposed = JSON.parse(decomposeResponse.message.content) as DecomposedTask;
  } catch {
    // If JSON parse fails, fall back to no delegations
    decomposed = { delegations: [] };
  }

  // No delegations needed — just respond directly
  if (decomposed.delegations.length === 0) {
    console.log("  📋 No delegations needed — responding directly");

    const directResponse = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: PARENT_SYSTEM_PROMPT,
      messages,
    });

    messages.push(directResponse.message as Message);
    return {
      messages,
      mode: "parallel",
      children: [],
      totalDurationMs: Date.now() - start,
    };
  }

  console.log(`  📋 Delegating to ${decomposed.delegations.length} specialist(s)`);
  for (const d of decomposed.delegations) {
    console.log(`     → ${d.tool}: "${d.task}"`);
  }

  // Phase 2: Execute — spawn all children in parallel
  console.log("\n  🚀 Phase 2: Running children in parallel...");

  const childPromises = decomposed.delegations.map((d) =>
    executeDelegationTool(d.tool, { task: d.task }, 0),
  );
  const children = await Promise.allSettled(childPromises);

  const childResults: ChildAgentResult[] = children.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      agentName: decomposed.delegations[i].tool,
      task: decomposed.delegations[i].task,
      result: JSON.stringify({ error: `Child failed: ${result.reason}` }),
      toolCallCount: 0,
      durationMs: 0,
      status: "rejected" as const,
      error: String(result.reason),
    };
  });

  // Phase 3: Synthesize — combine child results into a unified response
  console.log("\n  🧩 Phase 3: Synthesizing results...");

  const resultsSummary = childResults
    .map((r) => `### ${r.agentName} (${r.status})\n${r.result}`)
    .join("\n\n");

  const synthesizeMessages: Message[] = [
    { role: "user", content: userMessage },
    {
      role: "assistant",
      content: "I delegated research to specialist agents. Here are their findings:",
    },
    {
      role: "user",
      content: `Here are the specialist research results:\n\n${resultsSummary}\n\nPlease synthesize these results into a unified, helpful response for the user's original request.`,
    },
  ];

  const synthesizeResponse = await ollama.chat({
    model: MODEL,
    // @ts-expect-error — system not in ChatRequest types but works at runtime
    system:
      "You are a trip planning orchestrator. Combine the specialist agent results into a clear, well-organized response. Highlight the best options and create a coherent itinerary when appropriate.",
    messages: synthesizeMessages,
  });

  messages.push(synthesizeResponse.message as Message);

  return {
    messages,
    mode: "parallel",
    children: childResults,
    totalDurationMs: Date.now() - start,
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function runParentAgent(
  userMessage: string,
  history: Message[],
  mode: DelegationMode,
): Promise<ParentAgentResult> {
  if (mode === "parallel") {
    return runParallelParent(userMessage, history);
  }
  return runSequentialParent(userMessage, history);
}
