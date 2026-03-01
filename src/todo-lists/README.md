# Show Your Work — How TODO Lists Make AI Agents Transparent

[Agent Patterns — TypeScript](../../README.md)

---

You ask an AI agent to set up a deployment pipeline. It takes 30 seconds, makes 8 tool calls, and produces a final answer. But during those 30 seconds? Silence. You're staring at a blank screen, wondering if the agent is stuck, looping, or halfway through a plan you can't see.

This is the **dead-time problem**. The agent's plan exists only in its implicit reasoning — buried in the message history, invisible to you, and vulnerable to context window compression. As conversations grow long, the plan can literally disappear from the model's effective context.

Production agents solve this with a deceptively simple pattern: give the agent a `todo_write` tool that creates a persistent, visible TODO list — a scaffold that exists _outside_ the message history.

## The Core Idea: A State-Only Tool

Most tools return data the LLM needs. `todo_write` is different — it returns an empty string. It exists purely for **side effects**: updating a persistent state object and rendering progress to the user's screen.

```
┌─────────────────────────────────────────┐
│            Agent ReAct Loop             │
│                                         │
│  ┌─────────┐     ┌──────────────────┐   │
│  │  LLM    │────▶│  todo_write()    │   │
│  │  call   │     │  returns ""      │   │
│  └────┬────┘     └────────┬─────────┘   │
│       │                   │             │
│       │            ┌──────▼─────────┐   │
│       │            │   TodoState    │   │
│       │            │  (persistent)  │   │
│       │            └──────┬─────────┘   │
│       │                   │             │
│  ┌────▼────────────┐     │             │
│  │  System prompt  │◀────┘             │
│  │  rebuilt with   │   injected fresh  │
│  │  current TODOs  │   each iteration  │
│  └─────────────────┘                   │
│                           │             │
│                    ┌──────▼─────────┐   │
│                    │  CLI renders   │   │
│                    │  ✅🔄⬜ live   │   │
│                    └────────────────┘   │
└─────────────────────────────────────────┘
```

The TODO state flows through two channels simultaneously:

1. **Back to the LLM** — injected into the system prompt every loop iteration, so the agent always sees its current progress
2. **To the user** — rendered as emoji checkboxes in the terminal after each update

## The TodoItem Data Structure

Every production TODO scaffold — Claude Code's `TodoWrite`, Gemini CLI's `write_todos`, OpenHands' plan tool — converges on essentially the same shape:

```typescript
interface TodoItem {
  id: string;
  content: string; // what to do
  status: "pending" | "in_progress" | "completed"; // where it stands
  activeForm?: string; // present-tense UI label ("Configuring lint stage")
}
```

The `activeForm` field is a UX detail worth noting: while `content` describes the task ("Configure lint stage"), `activeForm` describes what's happening _right now_ ("Configuring lint stage"). Claude Code uses this for spinner text — the user sees "Configuring lint stage..." while the agent works.

## TodoState: Storage Outside Messages

The critical architectural decision is where the TODO list lives. It can't live in the message history because:

- **Context summarization** compresses or drops messages as conversations grow
- **Lost in the middle** — information buried deep in conversation history gets less attention from the LLM
- **Token waste** — the full TODO list appears in every `todo_write` call, duplicated across the history

Instead, `TodoState` is a separate object that persists across the entire conversation:

```typescript
class TodoState {
  private items: TodoItem[] = [];
  private updateCount = 0;

  // Full replacement — send complete list every time
  update(items: TodoItem[]): void {
    this.items = items;
    this.updateCount++;
  }

  // Formats for system prompt injection: [x]/[~]/[ ] checkboxes
  toPromptString(): string {
    const lines = this.items.map((item) => {
      const marker =
        item.status === "completed" ? "[x]" : item.status === "in_progress" ? "[~]" : "[ ]";
      return `${marker} ${item.content}`;
    });
    return `\n## Current TODO List\n${lines.join("\n")}`;
  }
}
```

### Full Replacement, Not Incremental Updates

Every production implementation uses **full replacement**: the LLM sends the complete TODO list on every `todo_write` call, not a partial patch. This matches Claude Code and Gemini CLI's approach.

Why? Incremental updates sound efficient but create **drift**. If the LLM sends "mark item 3 as done" but the state already changed, you get desync. OpenHands initially tried incremental updates and hit this exact failure mode. Full replacement is idempotent — the list is always exactly what the LLM last intended.

## The Agent Loop Modification

The ReAct loop needs exactly one change: rebuild the system prompt every iteration with the current TODO state.

```typescript
while (true) {
  // ✨ Key mechanism: system prompt rebuilt EVERY iteration
  const systemPrompt = buildSystemPrompt(mode, todoState);

  const response = await ollama.chat({
    model: MODEL,
    system: systemPrompt, // fresh TODO state at top of context
    messages,
    tools,
  });

  // ... handle tool calls ...

  if (name === "todo_write") {
    renderTodoProgress(todoState); // real-time CLI output
    messages.push({ role: "tool", content: "" }); // empty result
  }
}
```

Because the TODO state is injected into the system prompt (which sits at the very top of the context window), it's always in the model's highest-attention zone. It never "sinks" into the middle of a long conversation.

## With TODOs vs Without: The Difference

Run the same task in both modes to see the contrast:

**With TODOs** (`pnpm dev:todo-lists`):

```
📋 TODO Progress:
  🔄 Inspect project configuration
  ⬜ Choose pipeline template
  ⬜ Configure install stage
  ⬜ Configure lint stage
  ⬜ Configure test stage
  ⬜ Configure build stage
  ⬜ Validate pipeline

  🔧 Tool call: inspect_project
     Args: { "project_name": "webapp-frontend" }

📋 TODO Progress:
  ✅ Inspect project configuration
  🔄 Choosing pipeline template
  ⬜ Configure install stage
  ...
```

You see progress in real time. You know what's coming next, what's done, and what's in flight.

**Without TODOs** (`pnpm dev:todo-lists:no-todos`):

```
  🔧 Tool call: inspect_project
     Args: { "project_name": "webapp-frontend" }
  🔧 Tool call: list_pipeline_templates
  🔧 Tool call: configure_stage
     Args: { "stage": "install", ... }
  ...
```

Same tool calls, same result — but during execution you have no visibility into the agent's plan. You see tools firing but don't know how many are left or what the overall strategy is.

## Contrast with the Reasoning Tool

This concept pairs with [Reasoning Tool](../reasoning-tool/README.md), but they serve fundamentally different purposes:

| Dimension                  | Reasoning Tool                   | TODO Lists                                |
| -------------------------- | -------------------------------- | ----------------------------------------- |
| **Persistence**            | Ephemeral (one thought per call) | Persistent (survives entire conversation) |
| **Scope**                  | Single decision point            | Multi-step task plan                      |
| **Visibility**             | Internal deliberation            | External progress tracking                |
| **Survives summarization** | No (lives in messages)           | Yes (lives in separate state)             |
| **User-facing**            | Optional (debug tool)            | Primary (progress indicator)              |

Think of it this way: the Reasoning Tool is the agent _thinking_. The TODO list is the agent _planning and tracking_.

In a production system you'd use both: the Reasoning Tool for complex decisions within a step ("should I use the standard or simple template?"), and the TODO list for tracking progress across all steps.

## Anti-Patterns to Watch For

Research and production experience surface several failure modes:

**Hallucinated completion.** The agent marks a task as "completed" without actually performing the work. Mitigation: validate that the expected tool call appeared between the status change from `in_progress` to `completed`.

**Scope creep.** The agent adds unrequested items to the TODO list ("I'll also set up monitoring and alerting"). The system prompt should constrain the agent to the user's request.

**Format drift.** In long sessions, the LLM gradually produces malformed `todos_json`. Full replacement helps here — each call is a fresh valid list, not a patch on potentially corrupted state. Parsing errors are silently ignored rather than crashing the agent.

**Plan-execution disconnect.** The scaffold shows progress but the underlying tools weren't actually called. This is the "dashboard lie" — looking good on paper while nothing happened underneath. Cross-referencing tool call logs with TODO status transitions catches this.

## Depth-Gating: A Note for Multi-Agent Systems

In single-agent systems like this demo, every task gets a TODO list. In multi-agent systems, you need **depth-gating**: only the top-level orchestrator maintains the TODO scaffold. Sub-agents work on individual items without creating their own nested lists.

Without depth-gating, you get recursive TODO lists — the orchestrator's list contains items that each spawn their own lists, creating confusion about which level of the hierarchy you're tracking. Claude Code handles this by only enabling `TodoWrite` for the primary agent, not for spawned sub-agents.

## In the Wild: Coding Agent Harnesses

The TODO list pattern has become so fundamental that every major coding agent harness has its own implementation — but with a twist that goes beyond simple progress tracking. In production harnesses, TODO lists serve two distinct purposes: **communicating progress to the user** and **manipulating the model's own attention**. The second purpose is the less obvious and more architecturally interesting one.

**Claude Code** offers the most evolved implementation. Its original `TodoWrite` tool — a single tool that accepted the full list as JSON — has been replaced by a full [Tasks system](https://medium.com/@richardhightower/claude-code-todos-to-tasks-5a1b0e351a1c) with four specialized tools: `TaskCreate`, `TaskUpdate`, `TaskGet`, and `TaskList`. The upgrade added [dependency tracking](https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/tool-description-taskcreate.md) via `blocks`/`blockedBy` fields, enabling DAG-based workflows where Task B cannot start until Task A completes. Each task has an `activeForm` field (present continuous tense like "Running tests") used for spinner text, while the `subject` uses imperative form ("Run tests"). Tasks persist to `~/.claude/tasks/` as JSONL files, surviving not just context summarization but entire session boundaries — multiple Claude Code sessions can share a task list via the `CLAUDE_CODE_TASK_LIST_ID` environment variable, enabling [multi-session coordination](https://deepwiki.com/FlorianBruniaux/claude-code-ultimate-guide/8-task-management). The depth-gating principle described above comes directly from Claude Code: only the primary agent creates tasks, not spawned sub-agents.

**Manus** takes the most intellectually honest approach to what TODO lists really do. Instead of a dedicated tool, Manus [writes a `todo.md` file](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) to its sandboxed filesystem — a plain markdown checklist that it reads and updates on every turn. The Manus team explicitly describes this as "attention manipulation": by constantly rewriting the todo list, the agent recites its objectives into the end of the context, pushing the global plan into the model's recent attention span. Since typical Manus tasks average around 50 tool calls, the plan would otherwise sink deep into conversation history and lose influence over the model's decisions due to lost-in-the-middle effects. The checklist _is_ the plan, and rewriting it is how Manus keeps the model focused. This is the same principle as our demo's system-prompt injection, but Manus achieves it through the filesystem rather than a tool return value — using what they call the "file system as infinite context."

**Gemini CLI** follows a design closest to this demo with its [`write_todos` tool](https://geminicli.com/docs/tools/todos/). The agent maintains an internal subtask list for multi-step requests, with a four-status model and real-time display: the current in-progress task appears above the input box, and pressing `Ctrl+T` toggles the full list. Like Claude Code's original `TodoWrite`, it uses full replacement semantics — each call sends the complete list. The tool is enabled by default but can be disabled via `settings.json`, reflecting a design philosophy where the scaffold is valuable enough to be on by default but not mandatory.

**Devin** takes a more user-facing approach with [Interactive Planning](https://cognition.ai/blog/devin-2). Within seconds of starting a session, Devin analyzes the codebase and proposes an initial plan that the user can review and adjust before execution begins. During execution, progress updates are visible in the UI — users can click into any update to see the specific code edits or shell commands from that step. Devin's checkpoints function as verifiable task boundaries: restoring a checkpoint rolls back both files and memory, making the plan not just a progress indicator but a navigable timeline. This is the TODO pattern pushed furthest toward project management, with the scaffold serving as the primary interface between user and agent rather than a background mechanism.

The convergence is striking: every harness independently arrived at some form of persistent, visible task tracking. But the key insight is in _why_ it works. User communication is the obvious benefit — you see progress instead of silence. The deeper benefit is cognitive scaffolding for the model itself. Whether injected into the system prompt (Claude Code, Gemini CLI), rewritten to a file that re-enters context (Manus), or used as explicit plan-then-execute phases (Devin), the TODO list keeps the agent's goals in its highest-attention zone across arbitrarily long conversations.

## Key Takeaways

1. **TODO lists are state-only tools** — `todo_write` returns an empty string. It exists for persistent state and UI communication, not to provide information to the LLM.

2. **Store outside messages** — The TODO state must live in a separate object, not embedded in the conversation history. This is what makes it survive context window summarization.

3. **Inject into system prompt every iteration** — Rebuilding the system prompt with current TODO state keeps it in the model's highest-attention zone. The agent always knows where it stands.

4. **Full replacement, not incremental** — Send the complete list every time. It's slightly more tokens per call but eliminates drift, desync, and corruption from partial patches.

5. **Real-time rendering is the point** — The primary value isn't helping the LLM remember (though it does). It's giving the user visibility into what the agent is doing, turning dead-time silence into transparent progress.

## Sources & Further Reading

- [HiAgent: Hierarchical Working Memory](https://arxiv.org/abs/2408.09559) — ACL 2025. 2x success rate with structured working memory chunks.
- [Pre-Act: Multi-Step Planning](https://arxiv.org/abs/2505.09970) — 70% higher action recall vs ReAct.
- [Plan-and-Act](https://arxiv.org/abs/2503.09572) — ICML 2025. SOTA on WebArena-Lite with separated planning/execution.
- [ReAct: Reasoning + Acting](https://arxiv.org/abs/2210.03629) — The foundational paper on reasoning traces in agent loops.
- [Claude Code Todos to Tasks](https://medium.com/@richardhightower/claude-code-todos-to-tasks-5a1b0e351a1c) — Rick Hightower's deep dive on the evolution from TodoWrite to Tasks.
- [Agent Design Lessons from Claude Code](https://jannesklaas.github.io/ai/2025/07/20/claude-code-agent-design.html) — Jannes Klaas on persistent scaffolding patterns.
- [Gemini CLI write_todos](https://geminicli.com/docs/tools/todos/) — Google's implementation with four-status model.
- [OpenHands Planning Tool](https://github.com/OpenHands/OpenHands/issues/9970) — Discussion on incremental vs full replacement.
- [How Agents Plan Tasks with To-Do Lists](https://towardsdatascience.com/how-agents-plan-tasks-with-to-do-lists/) — Towards Data Science overview.
- [Escaping Context Amnesia](https://www.hadijaveed.me/2025/11/26/escaping-context-amnesia-ai-agents/) — Why persistent scaffolds matter for long conversations.
- [Context Engineering for Agents](https://blog.langchain.com/context-engineering-for-agents/) — LangChain's perspective on state management outside messages.
- [Memory in the Age of AI Agents](https://arxiv.org/abs/2512.13564) — Survey on external memory architectures.
