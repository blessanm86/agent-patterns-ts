import ollama from "ollama";
import { tools, executeTool, TOOL_RISK_MAP, describeAction } from "./tools.js";
import { MODEL } from "../shared/config.js";
import type { ProtocolEvent, ApprovalRequestItem } from "./types.js";
import type { Message } from "../shared/types.js";

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a helpful restaurant concierge assistant. You can search for restaurants, view menus, make reservations, and cancel reservations.

Be concise and friendly. When a user wants to find a restaurant, use the search tool. When they want to see what's available to eat, use the menu tool. Help them book and manage reservations.

If a user mentions an existing reservation to cancel, use the cancel_reservation tool with the reservation ID they provide.`;

// ─── Callbacks ───────────────────────────────────────────────────────────────
//
// The agent loop is transport-agnostic. It communicates with the outside world
// through two injected callbacks:
//
//   emit             — push a protocol event to the client (fire-and-forget)
//   requestApproval  — pause the loop until the client approves or denies

export type Emit = (event: ProtocolEvent) => void;
export type RequestApproval = (item: ApprovalRequestItem) => Promise<"approved" | "denied">;

// ─── Agent Loop ──────────────────────────────────────────────────────────────
//
// Standard ReAct loop: call LLM → if tool calls, execute them → loop.
// Two additions over the vanilla loop:
//   1. Every action emits protocol events (item lifecycle)
//   2. High-risk tools pause for approval before executing

export async function runAgentLoop(
  userMessage: string,
  history: Message[],
  threadId: string,
  turnId: string,
  emit: Emit,
  requestApproval: RequestApproval,
): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  let itemCounter = 0;
  function nextItemId(): string {
    return `${turnId}-item-${itemCounter++}`;
  }

  while (true) {
    // ── Call the LLM with streaming ───────────────────────────────────────
    const agentItemId = nextItemId();
    emit({
      type: "item.started",
      threadId,
      turnId,
      item: {
        id: agentItemId,
        turnId,
        threadId,
        type: "agent_message",
        status: "started",
        content: "",
        createdAt: Date.now(),
      },
    });

    const stream = await ollama.chat({
      model: MODEL,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      stream: true,
    } as Parameters<typeof ollama.chat>[0] & { stream: true });

    let contentBuffer = "";
    let toolCalls: Message["tool_calls"] = [];

    for await (const chunk of stream) {
      if (chunk.message.content) {
        contentBuffer += chunk.message.content;
        emit({
          type: "item.delta",
          threadId,
          turnId,
          itemId: agentItemId,
          delta: chunk.message.content,
        });
      }
      if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
        toolCalls = chunk.message.tool_calls;
      }
    }

    // Complete the agent message item
    emit({
      type: "item.completed",
      threadId,
      turnId,
      item: {
        id: agentItemId,
        turnId,
        threadId,
        type: "agent_message",
        status: "completed",
        content: contentBuffer,
        createdAt: Date.now(),
      },
    });

    // Push assembled assistant message to history
    const assistantMessage: Message = { role: "assistant", content: contentBuffer };
    if (toolCalls && toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls;
    }
    messages.push(assistantMessage);

    // ── No tool calls → done ────────────────────────────────────────────
    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    // ── Execute tool calls ──────────────────────────────────────────────
    for (const toolCall of toolCalls) {
      const { name, arguments: args } = toolCall.function;
      const toolArgs = args as Record<string, string>;
      const risk = TOOL_RISK_MAP[name] ?? "high";

      // Check if this tool needs approval
      if (risk === "high") {
        const approvalItemId = nextItemId();
        const approvalItem: ApprovalRequestItem = {
          id: approvalItemId,
          turnId,
          threadId,
          type: "approval_request",
          status: "started",
          toolName: name,
          toolArgs,
          riskLevel: risk,
          description: describeAction(name, toolArgs),
          createdAt: Date.now(),
        };

        emit({ type: "item.started", threadId, turnId, item: approvalItem });

        // ── PAUSE: wait for client approval ───────────────────────────
        const decision = await requestApproval(approvalItem);

        approvalItem.resolution = decision;
        approvalItem.status = "completed";
        emit({ type: "item.completed", threadId, turnId, item: approvalItem });

        if (decision === "denied") {
          // Feed denial as tool result — model can adapt
          const denialResult = JSON.stringify({
            error: "Action denied by user",
            message:
              "The user chose not to proceed with this action. Acknowledge the denial and ask if they want to do something else.",
          });
          messages.push({ role: "tool", content: denialResult });
          continue;
        }
      }

      // Execute the tool
      const toolItemId = nextItemId();
      emit({
        type: "item.started",
        threadId,
        turnId,
        item: {
          id: toolItemId,
          turnId,
          threadId,
          type: "tool_execution",
          status: "started",
          toolName: name,
          toolArgs,
          createdAt: Date.now(),
        },
      });

      const toolStart = Date.now();
      const result = executeTool(name, toolArgs);
      const durationMs = Date.now() - toolStart;

      emit({
        type: "item.completed",
        threadId,
        turnId,
        item: {
          id: toolItemId,
          turnId,
          threadId,
          type: "tool_execution",
          status: "completed",
          toolName: name,
          toolArgs,
          result,
          durationMs,
          createdAt: Date.now(),
        },
      });

      messages.push({ role: "tool", content: result });
    }
  }

  return messages;
}
