import type * as readline from "readline";
import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import {
  needsApproval,
  requestApproval,
  describeAction,
  TOOL_RISK_MAP,
  AuditTrail,
  type ApprovalMode,
  type RiskLevel,
} from "./approval.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a project management assistant for Team Alpha's sprint board.
You help manage tasks: listing, creating, updating status, reassigning, and deleting.

Guidelines:
- Always check the current board state before making changes (use list_tasks or get_task_detail first)
- When asked to delete tasks, confirm which specific tasks will be affected
- If a request is ambiguous, ask for clarification before acting
- After completing an action, briefly confirm what was done

The team members are Alice, Bob, and Charlie.
Task IDs follow the format TASK-N (e.g. TASK-1, TASK-2).
Statuses are: open, in-progress, done.`;

// ─── Result Types ────────────────────────────────────────────────────────────

export interface AgentResult {
  messages: Message[];
  iterations: number;
  toolCalls: number;
  autoApproved: number;
  humanApproved: number;
  denied: number;
  modified: number;
}

// ─── Max Iterations (safety net) ─────────────────────────────────────────────

const MAX_ITERATIONS = 15;

// ─── HITL ReAct Loop ─────────────────────────────────────────────────────────
//
// Standard while(true) ReAct loop with one addition: after the model decides
// to call a tool but before the tool executes, we check needsApproval().
// If approval is needed, we pause and prompt the user via the shared readline.
//
// Denial is returned as a tool result so the model can reason about it:
//   {"error": "Action denied by user", "reason": "..."}

export async function runHITLAgent(
  userMessage: string,
  history: Message[],
  mode: ApprovalMode,
  auditTrail: AuditTrail,
  rl: readline.Interface,
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  let iterations = 0;
  let toolCalls = 0;
  let autoApproved = 0;
  let humanApproved = 0;
  let denied = 0;
  let modified = 0;

  while (true) {
    if (iterations >= MAX_ITERATIONS) {
      messages.push({
        role: "assistant",
        content: `[Reached maximum iterations (${MAX_ITERATIONS}). Please try a more specific request.]`,
      });
      break;
    }

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    iterations++;
    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done reasoning
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // ── Tool calls → execute each with HITL interception ─────────────────
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const risk: RiskLevel = TOOL_RISK_MAP[name] ?? "high";
      toolCalls++;

      if (needsApproval(name, mode)) {
        // ── Pause for human approval ───────────────────────────────────
        const description = describeAction(name, args as Record<string, string>);
        const result = await requestApproval(
          { toolName: name, args: args as Record<string, string>, risk, description },
          rl,
        );

        if (result.decision === "denied") {
          denied++;
          auditTrail.log({
            toolName: name,
            args: args as Record<string, string>,
            risk,
            decision: "denied",
            reason: result.reason,
          });

          // Feed denial back as a tool result so the model can adapt
          const denialResult = JSON.stringify({
            error: "Action denied by user",
            reason: result.reason ?? "User chose not to proceed",
          });
          logToolCall(name, args as Record<string, string>, denialResult);
          messages.push({ role: "tool", content: denialResult });
          continue;
        }

        if (result.decision === "modified") {
          modified++;
          const finalArgs = result.modifiedArgs ?? (args as Record<string, string>);
          auditTrail.log({
            toolName: name,
            args: finalArgs,
            risk,
            decision: "modified",
          });

          const toolResult = executeTool(name, finalArgs);
          logToolCall(name, finalArgs, toolResult);
          messages.push({ role: "tool", content: toolResult });
          continue;
        }

        // Approved
        humanApproved++;
        auditTrail.log({
          toolName: name,
          args: args as Record<string, string>,
          risk,
          decision: "approved",
        });
      } else {
        // ── Auto-approved (risk below threshold) ───────────────────────
        autoApproved++;
        auditTrail.log({
          toolName: name,
          args: args as Record<string, string>,
          risk,
          decision: "auto-approved",
        });
      }

      // Execute the tool
      const toolResult = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, toolResult);
      messages.push({ role: "tool", content: toolResult });
    }
  }

  return { messages, iterations, toolCalls, autoApproved, humanApproved, denied, modified };
}
