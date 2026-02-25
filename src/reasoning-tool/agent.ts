import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import type { Message } from "./types.js";

// ─── System Prompt ────────────────────────────────────────────────────────────
//
// The system prompt is critical for the reasoning tool pattern.
// Because Ollama doesn't support tool_choice, we must instruct the model
// strongly to always call "think" before any other tool.

const SYSTEM_PROMPT = `You are a refund decision agent for an e-commerce platform.

Your job is to evaluate refund requests fairly and consistently using our policy.

IMPORTANT: You MUST call the "think" tool before every other tool call and before giving your final answer.
- Use "think" to reason about what you know and what you need to find out next.
- Set should_continue to "true" if you need to call another tool.
- Set should_continue to "false" when you have all the information needed to give a final answer.

Refund workflow:
1. Call think (should_continue: "true") — understand the request and plan your approach
2. Call lookup_order to get order details
3. Call think (should_continue: "true") — reason about what you found
4. Call check_refund_policy with the days and amount from the order
5. Call think (should_continue: "true") — decide whether to approve or deny
6. Call process_refund to record your decision
7. Call think (should_continue: "false") — confirm you are ready to respond
8. Give your final response to the customer

Never skip the think step. Never guess at order details — always look them up first.`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export async function runAgent(userMessage: string, history: Message[]): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // ── The Reasoning Tool Loop ──────────────────────────────────────────────────
  //
  // This is a modified ReAct loop with two exit paths:
  //
  //   Path 1 (fallback): Model makes no tool calls → break immediately.
  //     This handles cases where the model skips "think" entirely (common
  //     with small models on Ollama since tool_choice isn't supported).
  //
  //   Path 2 (primary): Model calls think with should_continue: "false".
  //     We finish executing all tool calls in this turn, then make one
  //     final no-tools call to get the plain text response.
  //
  // The second exit path is what makes this pattern distinct from standard
  // ReAct: the exit signal is structured (a boolean in the think tool's
  // arguments), not inferred from the absence of tool calls.

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // ── Path 1: No tool calls → model skipped think, respond directly ──────────
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // ── Process all tool calls in this turn ────────────────────────────────────
    let readyToRespond = false;

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;

      if (name === "think") {
        const thought = (args as Record<string, string>).thought ?? "";
        const shouldContinue = (args as Record<string, string>).should_continue;

        console.log(`\n  💭 Think: ${thought}`);

        messages.push({ role: "tool", content: "Thought recorded." });

        // ── Path 2: should_continue: false → agent is done reasoning ───────────
        if (shouldContinue === "false") {
          readyToRespond = true;
        }
      } else {
        console.log(`\n  🔧 Tool call: ${name}`);
        console.log(`     Args: ${JSON.stringify(args, null, 2).replace(/\n/g, "\n     ")}`);

        const result = executeTool(name, args as Record<string, string>);

        console.log(`     Result: ${result}`);

        messages.push({ role: "tool", content: result });
      }
    }

    // ── After processing all calls: if ready, do one final no-tools call ───────
    //
    // We make a separate call with no tools parameter so the model is forced
    // to produce a plain text response rather than another tool call.
    if (readyToRespond) {
      const finalResponse = await ollama.chat({
        model: MODEL,
        // @ts-expect-error — system not in ChatRequest types but works at runtime
        system: SYSTEM_PROMPT,
        messages,
        // No tools — forces a plain text reply
      });
      messages.push(finalResponse.message as Message);
      break;
    }

    // Loop back — model now reasons about the tool results
  }

  return messages;
}
