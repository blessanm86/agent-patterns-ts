import ollama from "ollama";
import { buildTools, executeTool, type AgentMode } from "./tools.js";
import { TodoState } from "./todo-state.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface AgentStats {
  mode: AgentMode;
  llmCalls: number;
  toolCalls: number;
  todoUpdates: number;
}

// ─── Agent Result ────────────────────────────────────────────────────────────

export interface AgentResult {
  messages: Message[];
  stats: AgentStats;
  todoState: TodoState;
}

// ─── System Prompts ──────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a CI/CD pipeline configuration assistant for the ShipIt platform. You help developers set up deployment pipelines for their projects.

When a user asks to set up a pipeline, follow this workflow:
1. Create a TODO list with todo_write outlining the steps you'll take
2. Inspect the project to understand its configuration
3. List available pipeline templates and pick the best one
4. Configure each required stage one by one
5. Validate the final pipeline configuration
6. Summarize the result

IMPORTANT — TODO list rules:
- Call todo_write BEFORE starting work to outline your plan
- Update status to "in_progress" BEFORE working on each step
- Update status to "completed" AFTER finishing each step
- Send the COMPLETE list every time (full replacement)
- Include an "activeForm" field for in-progress items (present-tense, e.g., "Inspecting project")

Available projects: webapp-frontend, api-service, data-pipeline.`;

const BASE_SYSTEM_PROMPT_NO_TODOS = `You are a CI/CD pipeline configuration assistant for the ShipIt platform. You help developers set up deployment pipelines for their projects.

When a user asks to set up a pipeline, follow this workflow:
1. Inspect the project to understand its configuration
2. List available pipeline templates and pick the best one
3. Configure each required stage one by one
4. Validate the final pipeline configuration
5. Summarize the result

Available projects: webapp-frontend, api-service, data-pipeline.`;

// ─── Build System Prompt ─────────────────────────────────────────────────────
//
// Key mechanism: the system prompt is rebuilt EVERY loop iteration with the
// current TODO state appended. This means:
//   - TODO state is always at the top of context (never "lost in the middle")
//   - Survives context window summarization (it's not in messages)
//   - The LLM always sees its current progress, even after many tool calls

function buildSystemPrompt(mode: AgentMode, todoState: TodoState): string {
  if (mode === "no-todos") return BASE_SYSTEM_PROMPT_NO_TODOS;
  return BASE_SYSTEM_PROMPT + todoState.toPromptString();
}

// ─── Render TODO to Console ──────────────────────────────────────────────────

function renderTodoProgress(todoState: TodoState): void {
  const lines = todoState.toDisplayLines();
  if (lines.length === 0) return;

  console.log("\n  \uD83D\uDCCB TODO Progress:");
  for (const line of lines) {
    console.log(line);
  }
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  history: Message[],
  mode: AgentMode = "with-todos",
  todoState: TodoState = new TodoState(),
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const tools = buildTools(mode);

  let llmCalls = 0;
  let toolCalls = 0;
  const todoUpdatesBefore = todoState.getUpdateCount();

  // ── ReAct Loop ─────────────────────────────────────────────────────────────

  while (true) {
    llmCalls++;

    // Rebuild system prompt every iteration with current TODO state
    const systemPrompt = buildSystemPrompt(mode, todoState);

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done reasoning
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      toolCalls++;

      const result = executeTool(name, args as Record<string, string>, todoState);

      if (name === "todo_write") {
        // State-only tool: render progress to console immediately (real-time UX)
        renderTodoProgress(todoState);
        // Don't log the full JSON — just note the update
        logToolCall(name, { items: `${todoState.getItems().length} items` }, "(state updated)");
      } else {
        logToolCall(name, args as Record<string, string>, result);
      }

      messages.push({ role: "tool", content: result });
    }
  }

  return {
    messages,
    stats: {
      mode,
      llmCalls,
      toolCalls,
      todoUpdates: todoState.getUpdateCount() - todoUpdatesBefore,
    },
    todoState,
  };
}
