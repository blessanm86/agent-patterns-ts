import ollama from "ollama";
import { SpanKind, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import { HOTEL_SYSTEM_PROMPT } from "../shared/prompts.js";
import type { Message } from "./types.js";

// ─── Instrumented ReAct Agent ────────────────────────────────────────────────
//
// This is the same ReAct loop from src/react/agent.ts, but wrapped with
// OpenTelemetry spans following the GenAI semantic conventions.
//
// Span hierarchy:
//
//   invoke_agent hotel-reservation         [SERVER — root span]
//   ├── chat qwen2.5:7b                    [CLIENT — each LLM call]
//   ├── execute_tool check_availability    [INTERNAL — each tool call]
//   ├── chat qwen2.5:7b                    [CLIENT]
//   └── ...
//
// The tracer is passed in (dependency injection) rather than imported globally,
// so the agent code doesn't depend on the specific tracing setup.

export async function runAgent(
  userMessage: string,
  history: Message[],
  tracer: Tracer,
): Promise<Message[]> {
  // The entire agent invocation is one root span
  return tracer.startActiveSpan(
    "invoke_agent hotel-reservation",
    { kind: SpanKind.SERVER },
    async (agentSpan) => {
      const messages: Message[] = [...history, { role: "user", content: userMessage }];

      try {
        // ── The ReAct Loop ──────────────────────────────────────────────
        while (true) {
          // Each LLM call gets its own span (CLIENT — calling an external service)
          const response = await tracer.startActiveSpan(
            `chat ${MODEL}`,
            { kind: SpanKind.CLIENT },
            async (chatSpan) => {
              try {
                const result = await ollama.chat({
                  model: MODEL,
                  // @ts-expect-error — system not in ChatRequest types but works at runtime
                  system: HOTEL_SYSTEM_PROMPT,
                  messages,
                  tools,
                });

                // Record GenAI semantic convention attributes
                chatSpan.setAttributes({
                  "gen_ai.operation.name": "chat",
                  "gen_ai.system": "ollama",
                  "gen_ai.request.model": MODEL,
                  "gen_ai.usage.input_tokens": result.prompt_eval_count ?? 0,
                  "gen_ai.usage.output_tokens": result.eval_count ?? 0,
                  "gen_ai.response.finish_reasons": result.message.tool_calls
                    ? "tool_calls"
                    : "stop",
                });

                chatSpan.setStatus({ code: SpanStatusCode.OK });
                return result;
              } catch (error) {
                chatSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: (error as Error).message,
                });
                throw error;
              } finally {
                chatSpan.end();
              }
            },
          );

          const assistantMessage = response.message as Message;
          messages.push(assistantMessage);

          // ── No tool calls → agent is done ──────────────────────────
          if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
            break;
          }

          // ── Tool calls → execute each one ──────────────────────────
          for (const toolCall of assistantMessage.tool_calls) {
            const { name, arguments: args } = toolCall.function;

            // Each tool execution gets its own span (INTERNAL)
            tracer.startActiveSpan(
              `execute_tool ${name}`,
              { kind: SpanKind.INTERNAL },
              (toolSpan) => {
                try {
                  const result = executeTool(name, args as Record<string, string>);
                  logToolCall(name, args as Record<string, string>, result);

                  // Record tool attributes
                  toolSpan.setAttributes({
                    "tool.name": name,
                    "tool.status": "ok",
                  });
                  toolSpan.setStatus({ code: SpanStatusCode.OK });

                  messages.push({ role: "tool", content: result });
                } catch (error) {
                  toolSpan.setAttributes({
                    "tool.name": name,
                    "tool.status": "error",
                  });
                  toolSpan.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (error as Error).message,
                  });
                  throw error;
                } finally {
                  toolSpan.end();
                }
              },
            );
          }

          // Loop back — model reasons about the tool results
        }

        agentSpan.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        agentSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        throw error;
      } finally {
        agentSpan.end();
      }

      return messages;
    },
  );
}
