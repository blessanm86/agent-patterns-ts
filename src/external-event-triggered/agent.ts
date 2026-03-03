import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { ActivityPoster } from "./activity-poster.js";
import type { Message, SSEEvent, WebhookEvent } from "./types.js";

// ─── Emit Callback ───────────────────────────────────────────────────────────

type Emit = (event: SSEEvent) => void;

// ─── System Prompt ───────────────────────────────────────────────────────────

const CICD_SYSTEM_PROMPT = `You are a CI/CD pipeline assistant bot that responds to GitHub webhook events.

You help developers by analyzing pull requests, diagnosing build failures, and answering questions.

## When handling a pull_request.opened event:
1. Use get_pr_diff to examine the changes
2. Use list_reviewers to find the best reviewers based on file ownership
3. Analyze the diff for potential issues (bugs, security concerns, missing tests)
4. Use post_comment to post a welcome comment summarizing:
   - What the PR does (1-2 sentences)
   - Any concerns or suggestions
   - Suggested reviewers with reason

## When handling a check_run.completed (failure) event:
1. Use get_build_logs to fetch the CI logs
2. Read the error carefully — identify the root cause
3. If needed, use get_file_content to look at the failing code
4. Use post_comment to post a diagnosis comment with:
   - What failed and why
   - A specific fix suggestion with code
   - Whether this is likely a flaky test or a real bug

## When handling an issue_comment.created (@bot mention) event:
1. Read the question carefully
2. Use available tools (get_file_content, get_pr_diff, etc.) to gather context
3. Use post_comment to answer the question directly

Important rules:
- Always use post_comment to respond — your text output is internal, not visible to the developer
- Be concise and actionable — developers want quick answers, not essays
- Include code snippets in your comments when suggesting fixes
- Format comments in GitHub-flavored markdown`;

// ─── Event → Prompt ──────────────────────────────────────────────────────────
//
// Converts a typed webhook event into a natural language prompt the model
// can reason about. This is the bridge between structured events and the
// freeform agent loop.

function eventToPrompt(event: WebhookEvent): string {
  switch (event.type) {
    case "pull_request.opened":
      return [
        `A new pull request was opened:`,
        `- PR #${event.payload.number}: "${event.payload.title}"`,
        `- Author: ${event.payload.author}`,
        `- Branch: ${event.payload.head_branch} → ${event.payload.base_branch}`,
        `- Files changed: ${event.payload.files_changed}`,
        ``,
        `Please analyze this PR: review the diff, suggest reviewers, and post a welcome comment.`,
      ].join("\n");

    case "check_run.completed":
      return [
        `A CI check run failed:`,
        `- Check: "${event.payload.name}"`,
        `- PR #${event.payload.pr_number}`,
        `- Commit: ${event.payload.sha}`,
        `- Run ID: ${event.payload.run_id}`,
        ``,
        `Please fetch the build logs, diagnose the failure, and post a comment with a fix suggestion.`,
      ].join("\n");

    case "issue_comment.created":
      return [
        `A developer mentioned @bot in a comment:`,
        `- Issue/PR #${event.payload.issue_number}`,
        `- Author: ${event.payload.author}`,
        `- Message: "${event.payload.body}"`,
        ``,
        `Please help answer their question. Use tools to gather context, then post a response comment.`,
      ].join("\n");
  }
}

// ─── Webhook Agent ───────────────────────────────────────────────────────────
//
// Adapts the streaming ReAct loop for webhook-triggered execution:
//   - No user conversation history — each event starts fresh
//   - ActivityPoster emits heartbeats during long processing
//   - post_comment tool calls trigger platform_post SSE events

export async function runWebhookAgent(
  event: WebhookEvent,
  sessionId: string,
  emit: Emit,
): Promise<void> {
  const prompt = eventToPrompt(event);
  const messages: Message[] = [{ role: "user", content: prompt }];

  const startTime = Date.now();
  let toolCallCount = 0;

  // ── ActivityPoster: heartbeat while processing ────────────────────────────
  const poster = new ActivityPoster((message) => {
    emit({ type: "heartbeat", sessionId, message });
  });

  poster.start();
  try {
    while (true) {
      // ── Stream the LLM response ───────────────────────────────────────────
      const stream = await ollama.chat({
        model: MODEL,
        system: CICD_SYSTEM_PROMPT,
        messages,
        tools,
        stream: true,
      } as Parameters<typeof ollama.chat>[0] & { stream: true });

      let contentBuffer = "";
      let toolCalls: Message["tool_calls"] = [];

      for await (const chunk of stream) {
        if (chunk.message.content) {
          contentBuffer += chunk.message.content;
          poster.recordActivity();
          if (poster.shouldEmit()) {
            emit({ type: "text", sessionId, content: chunk.message.content });
          }
        }
        if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
          toolCalls = chunk.message.tool_calls;
        }
      }

      // Emit any remaining buffered text
      if (contentBuffer) {
        emit({ type: "text", sessionId, content: contentBuffer });
      }

      const assistantMessage: Message = { role: "assistant", content: contentBuffer };
      if (toolCalls && toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls;
      }
      messages.push(assistantMessage);

      // ── No tool calls → done ──────────────────────────────────────────────
      if (!toolCalls || toolCalls.length === 0) break;

      // ── Execute tool calls ────────────────────────────────────────────────
      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall.function;
        toolCallCount++;

        emit({
          type: "tool_call",
          sessionId,
          name,
          arguments: args as Record<string, string>,
        });

        poster.recordActivity();

        const toolStart = Date.now();
        const result = executeTool(name, args as Record<string, string>);
        const durationMs = Date.now() - toolStart;

        emit({ type: "tool_result", sessionId, name, result, durationMs });

        // ── Platform post detection ─────────────────────────────────────────
        // When the agent calls post_comment, it's posting back to the platform.
        // Emit a special event so the UI shows it prominently.
        if (name === "post_comment") {
          const commentArgs = args as { target?: string; body?: string };
          emit({
            type: "platform_post",
            sessionId,
            target: commentArgs.target ?? sessionId,
            body: commentArgs.body ?? "(comment posted)",
          });
        }

        messages.push({ role: "tool", content: result });
      }
    }
  } finally {
    poster.stop();
  }

  emit({
    type: "done",
    sessionId,
    totalDurationMs: Date.now() - startTime,
    toolCallCount,
  });
}
