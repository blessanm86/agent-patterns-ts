import type { Message } from "../shared/types.js";

// ─── TodoItem ────────────────────────────────────────────────────────────────
//
// The data structure every production TODO scaffold converges on:
// content + status + optional activeForm for real-time UI spinners.
// Matches Claude Code TodoWrite, Gemini CLI write_todos, OpenHands plan.json.

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string; // present-tense label for UI (e.g., "Configuring lint stage")
}

// ─── TodoState ───────────────────────────────────────────────────────────────
//
// Persistent state object that lives OUTSIDE the message history.
// Key properties:
//   - Survives context window summarization (not embedded in messages)
//   - Injected fresh into system prompt every loop iteration
//   - Full replacement on each update (avoids incremental drift)

export class TodoState {
  private items: TodoItem[] = [];
  private updateCount = 0;

  // ── Full replacement update ──────────────────────────────────────────────
  // Claude Code and Gemini CLI both use this pattern. The LLM sends the
  // complete list every time — no partial patches, no incremental drift.

  update(items: TodoItem[]): void {
    this.items = items;
    this.updateCount++;
  }

  getItems(): TodoItem[] {
    return this.items;
  }

  getUpdateCount(): number {
    return this.updateCount;
  }

  hasItems(): boolean {
    return this.items.length > 0;
  }

  // ── System prompt injection format ───────────────────────────────────────
  // Renders as markdown checkboxes for the LLM to read.
  // Injected at the TOP of the system prompt each iteration so it's
  // always visible (never "lost in the middle").

  toPromptString(): string {
    if (this.items.length === 0) return "";

    const lines = this.items.map((item) => {
      const marker =
        item.status === "completed" ? "[x]" : item.status === "in_progress" ? "[~]" : "[ ]";
      return `${marker} ${item.content}`;
    });

    return `\n## Current TODO List\n${lines.join("\n")}`;
  }

  // ── CLI display format ───────────────────────────────────────────────────
  // Renders with emoji status indicators for real-time terminal output.

  toDisplayLines(): string[] {
    if (this.items.length === 0) return [];

    return this.items.map((item) => {
      const icon =
        item.status === "completed"
          ? "\u2705"
          : item.status === "in_progress"
            ? "\uD83D\uDD04"
            : "\u2B1C";
      const label =
        item.status === "in_progress" && item.activeForm ? item.activeForm : item.content;
      return `  ${icon} ${label}`;
    });
  }

  // ── Completion stats ─────────────────────────────────────────────────────

  getCompletionRatio(): string {
    if (this.items.length === 0) return "0/0";
    const completed = this.items.filter((i) => i.status === "completed").length;
    return `${completed}/${this.items.length}`;
  }

  // ── Message filtering (summarization exclusion demo) ─────────────────────
  // Strips todo_write tool calls from message history. In production, a
  // summarizer would call this before compressing context — the TODO state
  // is already persisted externally, so including it in summarized history
  // would be redundant and waste tokens.

  static filterTodoMessages(messages: Message[]): Message[] {
    return messages.filter((msg) => {
      if (msg.role !== "assistant" || !msg.tool_calls) return true;
      // Keep the message only if it has non-todo tool calls
      const nonTodoCalls = msg.tool_calls.filter((tc) => tc.function.name !== "todo_write");
      if (nonTodoCalls.length === msg.tool_calls.length) return true;
      // If ALL calls were todo_write, skip the message entirely
      if (nonTodoCalls.length === 0) return false;
      // Mixed: keep but strip todo_write calls (mutates — fine for demo)
      msg.tool_calls = nonTodoCalls;
      return true;
    });
  }
}
