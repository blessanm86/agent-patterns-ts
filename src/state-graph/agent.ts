import ollama from "ollama";
import { tools, executeToolAsync } from "./tools.js";
import { StateGraph, END } from "./graph.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import { HOTEL_SYSTEM_PROMPT } from "../shared/prompts.js";
import type { ChannelConfig, StateFromSchema } from "./graph.js";
import type { Message } from "../shared/types.js";

// ─── Config ──────────────────────────────────────────────────────────────────
const MAX_ITERATIONS = 15;

// ─── State Schema ────────────────────────────────────────────────────────────
//
// Three channels:
//   messages   — append-only (reducer concatenates arrays)
//   iterations — last-write-wins (overwrite)
//   done       — last-write-wins (overwrite)

const agentStateSchema = {
  messages: {
    default: () => [] as Message[],
    reducer: (a: Message[], b: Message[]) => [...a, ...b],
  } as ChannelConfig<Message[]>,

  iterations: {
    default: () => 0,
  } as ChannelConfig<number>,

  done: {
    default: () => false,
  } as ChannelConfig<boolean>,
};

type AgentState = StateFromSchema<typeof agentStateSchema>;

// ─── Nodes ───────────────────────────────────────────────────────────────────

async function think(state: AgentState): Promise<Partial<AgentState>> {
  const response = await ollama.chat({
    model: MODEL,
    // @ts-expect-error — system not in ChatRequest types but works at runtime
    system: HOTEL_SYSTEM_PROMPT,
    messages: state.messages,
    tools,
  });

  return {
    messages: [response.message as Message],
    iterations: state.iterations + 1,
  };
}

async function executeToolNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage?.tool_calls?.length) {
    return {};
  }

  const toolResults: Message[] = [];

  for (const toolCall of lastMessage.tool_calls) {
    const { name, arguments: args } = toolCall.function;

    const result = await executeToolAsync(name, args as Record<string, string>);
    logToolCall(name, args as Record<string, string>, result);

    toolResults.push({ role: "tool", content: result });
  }

  return { messages: toolResults };
}

async function synthesize(_state: AgentState): Promise<Partial<AgentState>> {
  // The final response is already in messages from the last `think` call.
  // This node just marks the agent as done.
  return { done: true };
}

// ─── Routing (conditional edge, not a node) ──────────────────────────────────

function routeAfterThink(state: AgentState): string {
  const lastMessage = state.messages[state.messages.length - 1];
  const hasToolCalls = lastMessage?.tool_calls && lastMessage.tool_calls.length > 0;

  if (!hasToolCalls || state.iterations >= MAX_ITERATIONS) {
    return "synthesize";
  }

  return "execute_tool";
}

// ─── Graph Wiring ────────────────────────────────────────────────────────────
//
//          ┌─────────────────────────────────────┐
//          │                                     │
//          ▼                                     │
//       ┌──────┐    route (cond edge)    ┌───────────────┐
//       │ think │───────────────────────>│ execute_tool   │
//       └──────┘                         └───────────────┘
//          │
//          │ (no tool calls / max iterations)
//          ▼
//       ┌─────────────┐
//       │ synthesize   │──> END
//       └─────────────┘

const graph = new StateGraph(agentStateSchema)
  .addNode("think", think)
  .addNode("execute_tool", executeToolNode)
  .addNode("synthesize", synthesize)
  .setEntryPoint("think")
  .addConditionalEdge("think", routeAfterThink, ["execute_tool", "synthesize"])
  .addEdge("execute_tool", "think")
  .addEdge("synthesize", END)
  .compile();

// ─── Public API ──────────────────────────────────────────────────────────────

export interface GraphAgentResult {
  messages: Message[];
  iterations: number;
  nodeTrace: string[];
}

export async function runGraphAgent(
  userMessage: string,
  history: Message[],
): Promise<GraphAgentResult> {
  const initialMessages: Message[] = [...history, { role: "user", content: userMessage }];

  const { state, trace } = await graph.run({
    messages: initialMessages,
  } as Partial<AgentState>);

  return {
    messages: state.messages,
    iterations: state.iterations,
    nodeTrace: trace,
  };
}
