// ─── Agent: ReAct Loop with execute_shell ────────────────────────────────────
//
// The agent has a single LLM tool: execute_shell. It sends shell commands to
// the sandboxed subprocess, which routes "tools ..." commands through the CLI
// binary to the host's tool registry via JSON-RPC over stdin/stdout.
//
// The model must discover tools via "tools list", learn their parameters via
// "tools describe <name>", and then invoke them via "tools invoke <name> --args=..."

import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message, ToolDefinition } from "../shared/types.js";
import type { ToolBridge } from "./tool-bridge.js";

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a helpful assistant with access to a sandboxed shell environment. You can execute shell commands using the execute_shell tool.

Inside the shell, there is a "tools" CLI that gives you access to various utilities. You MUST follow this workflow:

1. First, run "tools list" to see what tools are available
2. Before using any tool, run "tools describe <tool-name>" to learn its parameters
3. Then invoke it with "tools invoke <tool-name> --args='{"param":"value"}'"

IMPORTANT: You MUST describe a tool before invoking it. If you try to invoke a tool without describing it first, you will get an error.

Example workflow:
  execute_shell("tools list")
  execute_shell("tools describe weather.lookup")
  execute_shell("tools invoke weather.lookup --args='{\\"city\\":\\"Paris\\"}'")

The --args parameter must be valid JSON. Always use double quotes for JSON keys and string values.

When you have gathered enough information, respond directly to the user with a helpful answer. Do not show raw JSON to the user — summarize the results in natural language.`;

// ─── Tool Definition ─────────────────────────────────────────────────────────

const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "execute_shell",
      description:
        'Execute a shell command in the sandboxed environment. Use the "tools" CLI to discover and invoke available tools. Start with "tools list" to see available tools.',
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              'The shell command to execute (e.g., "tools list", "tools describe weather.lookup")',
          },
        },
        required: ["command"],
      },
    },
  },
];

// ─── Agent Stats ─────────────────────────────────────────────────────────────

interface AgentStats {
  llmCalls: number;
  toolCalls: number;
  shellCommands: number;
}

interface AgentResult {
  messages: Message[];
  stats: AgentStats;
}

// ─── ReAct Loop ──────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;

export async function runAgent(
  userMessage: string,
  history: Message[],
  bridge: ToolBridge,
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const stats: AgentStats = { llmCalls: 0, toolCalls: 0, shellCommands: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });
    stats.llmCalls++;

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done, return to user
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call (should only be execute_shell)
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      stats.toolCalls++;

      if (name === "execute_shell") {
        const command = args.command ?? "";
        stats.shellCommands++;

        const result = await bridge.executeShell(command);
        logToolCall(name, { command }, result, { maxResultLength: 300 });

        messages.push({ role: "tool", content: result });
      } else {
        messages.push({
          role: "tool",
          content: `Unknown tool: ${name}. Use execute_shell to run commands.`,
        });
      }
    }
  }

  return { messages, stats };
}
