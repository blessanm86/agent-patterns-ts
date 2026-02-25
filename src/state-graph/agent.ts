import ollama from "ollama";
import { tools, executeToolAsync } from "./tools.js";
import { StateGraph, END } from "./graph.js";
import type { ChannelConfig, StateFromSchema } from "./graph.js";
import type { Message } from "../shared/types.js";

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a friendly hotel reservation assistant for The Grand TypeScript Hotel.

Your goal is to help guests make a room reservation. Follow these steps in order:

1. Greet the guest and ask for their name
2. Ask for their desired check-in and check-out dates
3. Use the check_availability tool to find available rooms
4. Present the options clearly (room types and prices)
5. Ask the guest which room type they'd like
6. Use get_room_price to confirm the total cost and present it to the guest
7. Ask for confirmation before proceeding
8. Once confirmed, use create_reservation to book the room
9. Confirm the booking with the reservation ID

Important rules:
- Always use tools to check real availability and prices — never make up numbers
- If no rooms are available, suggest different dates
- Be concise and friendly
- Dates should be in YYYY-MM-DD format when calling tools`;

// ─── Config ──────────────────────────────────────────────────────────────────

const MODEL = process.env.MODEL ?? "qwen2.5:7b";
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
    system: SYSTEM_PROMPT,
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

    console.log(`  🔧 Tool call: ${name}`);
    console.log(`     Args: ${JSON.stringify(args, null, 2).replace(/\n/g, "\n     ")}`);

    const result = await executeToolAsync(name, args as Record<string, string>);

    console.log(`     Result: ${result}`);

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
