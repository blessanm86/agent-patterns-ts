import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import { SPECIALIST_PROFILES, generalAgent, getProfileByName } from "./profiles.js";
import type { AgentProfile } from "./profiles.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentMode = "routed" | "single";

export interface RoutingDecision {
  agent: string;
  confidence: number;
  reasoning: string;
}

export interface RoutedAgentResult {
  messages: Message[];
  routingDecision: RoutingDecision | null;
  profile: AgentProfile;
  mode: AgentMode;
  toolCallCount: number;
}

// ─── Router ──────────────────────────────────────────────────────────────────
//
// A single LLM call that classifies the user's message and picks the right
// specialist agent. Returns a structured JSON decision with confidence score.
//
// If confidence < 0.5 or the JSON parse fails, we fall back to the general agent.
// The router sees the last few messages for topic continuity (not just the latest).

const CONFIDENCE_THRESHOLD = 0.5;

function buildRouterPrompt(): string {
  const profileDescriptions = SPECIALIST_PROFILES.map(
    (p) => `- "${p.name}": ${p.description}`,
  ).join("\n");

  return `You are a routing classifier for a travel assistant. Your job is to read the user's message and decide which specialist agent should handle it.

Available agents:
${profileDescriptions}

Respond with a JSON object (no other text):
{
  "agent": "<agent_name>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<one sentence explaining your choice>"
}

Rules:
- Pick the SINGLE best agent for the user's primary intent
- Set confidence to 0.0-0.3 if the message is ambiguous or spans multiple domains equally
- Set confidence to 0.4-0.6 if the message leans toward one domain but is not clear-cut
- Set confidence to 0.7-1.0 if the message clearly belongs to one domain
- If the message is a greeting or general question, use low confidence`;
}

export async function routeToAgent(
  userMessage: string,
  history: Message[],
): Promise<{ profile: AgentProfile; decision: RoutingDecision }> {
  // Include last few messages for topic continuity
  const recentHistory = history.slice(-4);
  const routerMessages: Message[] = [...recentHistory, { role: "user", content: userMessage }];

  try {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: buildRouterPrompt(),
      messages: routerMessages,
      format: "json",
    });

    const decision = JSON.parse(response.message.content) as RoutingDecision;

    // Validate the decision
    if (!decision.agent || typeof decision.confidence !== "number") {
      throw new Error("Invalid router response format");
    }

    // Low confidence → fallback to general agent
    if (decision.confidence < CONFIDENCE_THRESHOLD) {
      console.log(
        `  🔀 Router: ${generalAgent.name} (confidence: ${decision.confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD} threshold)`,
      );
      console.log(`     Reason: ${decision.reasoning}`);
      return { profile: generalAgent, decision };
    }

    const profile = getProfileByName(decision.agent);
    console.log(`  🔀 Router: ${profile.name} (confidence: ${decision.confidence.toFixed(2)})`);
    console.log(`     Reason: ${decision.reasoning}`);

    return { profile, decision };
  } catch {
    // Parse failure → fallback to general agent
    console.log("  🔀 Router: general_agent (parse failure — falling back)");
    const fallbackDecision: RoutingDecision = {
      agent: "general_agent",
      confidence: 0,
      reasoning: "Router response could not be parsed",
    };
    return { profile: generalAgent, decision: fallbackDecision };
  }
}

// ─── Scoped ReAct Loop ───────────────────────────────────────────────────────
//
// The same while(true) ReAct loop from src/react/agent.ts, but parameterized:
// - System prompt comes from the profile
// - Tools come from the profile
// - Tool dispatcher comes from the profile
//
// The loop itself is identical. Only what's injected changes.

export async function runScopedAgent(
  userMessage: string,
  history: Message[],
  profile: AgentProfile,
): Promise<{ messages: Message[]; toolCallCount: number }> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
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

    // No tool calls → agent is done, return
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call using the profile's scoped dispatcher
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = profile.executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);
      toolCallCount++;

      messages.push({
        role: "tool",
        content: result,
      });
    }
  }

  return { messages, toolCallCount };
}

// ─── Main Entry Point ────────────────────────────────────────────────────────
//
// Called by the CLI on each user turn.
// - "routed" mode: route first, then run the selected specialist
// - "single" mode: skip routing, use the general agent with all tools

export async function runRoutedAgent(
  userMessage: string,
  history: Message[],
  mode: AgentMode,
): Promise<RoutedAgentResult> {
  if (mode === "single") {
    const { messages, toolCallCount } = await runScopedAgent(userMessage, history, generalAgent);
    return {
      messages,
      routingDecision: null,
      profile: generalAgent,
      mode,
      toolCallCount,
    };
  }

  // Routed mode: classify → route → run specialist
  const { profile, decision } = await routeToAgent(userMessage, history);
  const { messages, toolCallCount } = await runScopedAgent(userMessage, history, profile);

  return {
    messages,
    routingDecision: decision,
    profile,
    mode,
    toolCallCount,
  };
}
