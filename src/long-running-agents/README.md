# Long-Running Agents & Checkpointing

[Agent Patterns — TypeScript](../../README.md) · Builds on [State Graph](../state-graph/README.md)

Your agent processed 47 of 50 records, then crashed. Do you start over from record 1?

The answer should be no. But most agent implementations store state in memory — a conversation history array, local variables, maybe a running count. When the process dies (OOM, network timeout, user hits Ctrl+C, deploy restart), all that state vanishes. For a 30-second chatbot turn, this is fine. For a migration job that takes 45 minutes, it's catastrophic.

**Checkpointing** solves this by persisting agent progress to durable storage after each meaningful unit of work. On restart, the agent loads the checkpoint and continues from where it left off — no re-processing, no duplicate side effects, no wasted compute.

This pattern is the difference between "agents that work in demos" and "agents that work in production."

---

## The Core Idea

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Checkpoint-Resume Lifecycle                      │
│                                                                     │
│  Start ──→ Load checkpoint? ──→ Process item ──→ Save checkpoint    │
│              │                      │                │               │
│              │ (no checkpoint)      │ (4-node graph) │ (atomic       │
│              ▼                      ▼                │  write)       │
│            Fresh run          fetch → transform      │               │
│                               → validate → save      │               │
│              │                      │                │               │
│              │ (found checkpoint)   │                ▼               │
│              ▼                      │          More items? ──→ Done  │
│            Resume from              │               │               │
│            completedItems           └───────────────┘               │
│                                                                     │
│  Crash at any point → restart → load checkpoint → skip completed    │
└─────────────────────────────────────────────────────────────────────┘
```

The lifecycle has three guarantees:

1. **Durability** — progress survives crashes. Atomic writes (write-tmp-then-rename) prevent half-written checkpoints.
2. **Idempotency** — completed items are skipped on resume. Processing the same item twice has the same effect as processing it once.
3. **Graceful cancellation** — Ctrl+C finishes the current item, saves a checkpoint, then exits. A second Ctrl+C force-kills.

---

## The Demo: Recipe Migration

The demo migrates 20 messy old-format recipe records into clean structured records. Each recipe goes through a 4-node state graph:

```
fetch → transform (LLM) → validate → save → checkpoint
```

The **old format** is intentionally messy — free-text descriptions with embedded ingredients, inconsistent categories ("Main Course" vs "main" vs "APPETIZER"), and varied time formats ("30 min" vs "1 hour 15 minutes" vs "about 1 hour plus marinating"):

```typescript
{
  id: "recipe-004",
  name: "Chicken Tikka Masala",
  description: "Marinate 600g chicken thighs in 200ml yogurt, 2 tsp garam masala...",
  category: "main",          // inconsistent casing
  servings: "4 people",      // free text, not a number
  time: "about 1 hour plus marinating"  // unparseable
}
```

The **new format** is structured, typed, and normalized:

```typescript
{
  id: "recipe-004",
  name: "Chicken Tikka Masala",
  category: "main",           // enum: appetizer | main | side | dessert | beverage
  servings: 4,                // number
  prepTimeMinutes: 70,
  cookTimeMinutes: 30,
  totalTimeMinutes: 100,
  ingredients: [
    { name: "chicken thighs", amount: 600, unit: "g" },
    { name: "yogurt", amount: 200, unit: "ml" },
    // ...
  ],
  steps: ["Marinate chicken...", "Grill until charred...", "For sauce..."]
}
```

The LLM does the hard work in the `transform` step — parsing free text into structured fields with JSON mode. The other three steps are deterministic.

---

## Implementation Walkthrough

### 1. Checkpoint Store — Atomic Persistence

The `CheckpointStore` saves migration state as JSON files with atomic writes:

```typescript
// checkpoint-store.ts

export interface Checkpoint {
  runId: string; // UUID identifying this migration run
  totalItems: number; // 20 recipes
  completedItems: number; // how many done so far
  completedIds: string[]; // recipe IDs — for idempotency checks
  results: MigrationResult[]; // per-recipe outcomes (success/failed/skipped)
  status: "in_progress" | "completed" | "cancelled";
}

class CheckpointStore {
  save(checkpoint: Checkpoint): void {
    const target = this.filePath(checkpoint.runId);
    const tmp = `${target}.tmp`;

    // Write to .tmp first, then rename
    // Rename is atomic on most filesystems — a crash during write
    // leaves the old checkpoint intact instead of a half-written file
    fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2));
    fs.renameSync(tmp, target);
  }
}
```

**Why atomic writes matter:** `writeFileSync` is not atomic — if the process crashes mid-write, you get a half-written JSON file that fails to parse on restart. The write-tmp-then-rename pattern ensures you always have either the old checkpoint or the new one, never a corrupt intermediate state.

### 2. CheckpointableGraph — State Graph with Hooks

The `CheckpointableGraph` extends the [State Graph](../state-graph/README.md) pattern with two additions:

```typescript
// graph.ts

interface CheckpointHooks<S> {
  onNodeStart?: (nodeName: string, state: S) => void;
  onNodeEnd?: (nodeName: string, state: S) => void;
}

interface RunOptions<S> {
  signal?: AbortSignal; // for cancellation
  hooks?: CheckpointHooks<S>; // for checkpoint callbacks
}
```

The hooks are the extension point. The graph runtime calls them around each node, but doesn't know what they do — the agent provides checkpoint-saving behavior via `onNodeEnd`, keeping the graph runtime generic.

The `AbortSignal` check happens before each node:

```typescript
while (current !== END) {
  if (signal?.aborted) {
    return { state, trace, aborted: true };
  }
  // ... execute node ...
}
```

This is how graceful cancellation works — the graph checks the signal before starting each node, so a cancellation request finishes the current node cleanly rather than interrupting mid-execution.

### 3. The Migration Loop — Checkpoint After Each Recipe

The outer loop in `agent.ts` drives the migration. The key insight: checkpoint at the **recipe level**, not the node level. A single recipe takes a few seconds; the migration takes minutes. Recipe-level granularity is the right tradeoff between durability and overhead.

```typescript
// agent.ts — simplified

for (let i = 0; i < recipes.length; i++) {
  const recipe = recipes[i];

  // 1. Check cancellation signal
  if (signal?.aborted) {
    checkpoint.status = "cancelled";
    store.save(checkpoint);
    break;
  }

  // 2. Idempotency: skip already-completed recipes
  if (checkpoint.completedIds.includes(recipe.id)) {
    continue;
  }

  // 3. Run the per-recipe graph: fetch → transform → validate → save
  const result = await graph.run(
    { recipeId: recipe.id },
    { signal: AbortSignal.timeout(recipeTimeoutMs), hooks: { onNodeStart } },
  );

  // 4. Save checkpoint after each recipe
  checkpoint.completedItems++;
  checkpoint.completedIds.push(recipe.id);
  checkpoint.results.push(result);
  store.save(checkpoint); // atomic write
}
```

On resume, the loop simply skips recipes whose IDs are already in `completedIds`. This is idempotency at the recipe level — if a recipe was processed before the crash, it's not processed again.

### 4. SIGINT Handling — Two-Phase Shutdown

```typescript
// index.ts

const controller = new AbortController();
let cancelCount = 0;

process.on("SIGINT", () => {
  cancelCount++;
  if (cancelCount === 1) {
    // First Ctrl+C: graceful — finish current recipe, checkpoint, exit
    controller.abort();
  } else {
    // Second Ctrl+C: force exit
    process.exit(1);
  }
});
```

The first Ctrl+C sets the abort signal. The migration loop checks this signal before starting the next recipe, so the current recipe finishes, the checkpoint saves, and then the process exits cleanly. The user can re-run the command and it picks up exactly where it left off.

---

## Two Approaches: Replay vs. Checkpoint-Resume

When building durability for agents, there are two fundamental approaches:

### Replay-Based (Temporal, Restate)

The runtime records an **event history** of all completed activity results. On restart, the workflow replays deterministically — but when it reaches a previously-completed activity, the result is loaded from history instead of re-executing.

```
Workflow code: step1() → step2() → step3() → step4()
Event history: [step1_result, step2_result]
On restart:    replay step1 (from history) → replay step2 (from history) → execute step3 → ...
```

**Strengths:** Infrastructure-level durability. Workflow code is just code — no explicit checkpoint calls. The runtime handles everything.

**Constraints:** Workflow code must be deterministic (no random, no Date.now(), no external reads). Non-deterministic operations must be wrapped as "Activities." This separation is the core contract.

### Checkpoint-Resume (Our Approach, LangGraph)

The application explicitly saves state snapshots after each meaningful unit of work. On restart, the application loads the last snapshot and resumes from that point.

```
Processing items: [1, 2, 3, 4, 5, ...]
Checkpoint after item 3: { completedIds: [1, 2, 3], results: [...] }
On restart: load checkpoint → skip 1, 2, 3 → process 4, 5, ...
```

**Strengths:** Simple to reason about. No determinism constraints. The checkpoint is just a JSON file. Works with any LLM, any tool, any infrastructure.

**Constraints:** The developer must decide what to checkpoint and when. Missing a checkpoint point means lost work. Too many checkpoints means overhead.

### When to Use Which

| Scenario                                | Better fit                        |
| --------------------------------------- | --------------------------------- |
| Complex multi-step orchestration        | Replay (Temporal)                 |
| Batch processing with independent items | Checkpoint-resume                 |
| Existing infrastructure team            | Replay (Temporal has ops tooling) |
| Minimal infrastructure                  | Checkpoint-resume                 |
| Mixed deterministic/non-deterministic   | Replay (forces clean separation)  |
| Simple linear pipeline                  | Checkpoint-resume                 |

For most agent workloads — especially batch operations like migrations, data processing, and multi-item research — checkpoint-resume is the simpler and more practical choice. Replay-based systems shine when you have complex orchestration with multiple branching paths and need infrastructure-level guarantees.

---

## Key Patterns

### Idempotent Tools

Every tool that has side effects must be safe to call twice with the same input:

```typescript
function saveNewRecipe(recipe: NewRecipe): SaveResult {
  if (savedRecipes.has(recipe.id)) {
    return { saved: false, reason: "Already saved (idempotent skip)" };
  }
  savedRecipes.set(recipe.id, recipe);
  return { saved: true, reason: "Saved successfully" };
}
```

In production, this means database upserts instead of inserts, checking for existing records before creating, and using idempotency keys for API calls.

### Atomic Writes

Never write state directly to the final file. Write to a temporary file, then rename:

```typescript
fs.writeFileSync(path + ".tmp", data); // can be interrupted safely
fs.renameSync(path + ".tmp", path); // atomic on most filesystems
```

This is the same pattern used by databases (WAL), package managers (lockfiles), and configuration management tools.

### Graceful Cancellation with AbortSignal

Use `AbortSignal` instead of boolean flags. It composes with timeouts and integrates with Node.js APIs:

```typescript
// Per-recipe timeout
const timeoutSignal = AbortSignal.timeout(60_000);

// User cancellation
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

// The graph checks signal.aborted before each node
```

### Progress Reporting

Long-running operations need visibility. The progress reporter shows inline updates with ETA:

```
  [████████░░░░░░░░░░░░] 40% (8/20) | Chicken Tikka Masala → transform | 2m14s elapsed, ~3m21s remaining
  ✓ recipe-001 Spaghetti Carbonara        1.2s
  ✓ recipe-002 Caesar Salad               0.9s
  ✗ recipe-003 Banana Bread               0.8s (Validation failed)
```

---

## Anti-Patterns

**Prompt-driven state.** Storing progress in the conversation history ("You've completed 5 out of 20 recipes so far") is fragile. The LLM can hallucinate the count, the context window can truncate the message, and there's no way to programmatically query the state. Always externalize state to durable storage.

**Restart-from-zero.** Without checkpointing, every crash means starting over. At 2 seconds per recipe, 20 recipes is 40 seconds — annoying but survivable. At 2 minutes per item, 500 items is 16 hours. Checkpoint-resume is the difference between "the agent handles it" and "the operator manually babysits."

**Unbounded autonomy.** Long-running agents need budget controls: timeout per item, maximum total duration, maximum retries. Without these, a stuck LLM call can burn tokens indefinitely. The demo uses `AbortSignal.timeout(60_000)` per recipe as a safety net.

---

## In the Wild: Coding Agent Harnesses

Coding agent harnesses are the most visible long-running agent systems in production. Each one has evolved its own approach to persistence and crash recovery — the differences are instructive.

### Claude Code — Append-Only JSONL

Claude Code stores sessions as JSONL files at `~/.claude/projects/[folder]/[uuid].jsonl`. Each event (message, tool call, state update) is appended as a new line. This is crash-safe by design — at most one incomplete line is lost. Sessions can be resumed with `claude --continue` or `claude --resume`. Per-prompt file checkpoints track file modifications (but not Bash command changes), and the `/rewind` command can restore code, conversation, or both.

### Cline — Per-Tool-Call Shadow Git

Cline maintains a shadow Git repository alongside your project repo and creates a checkpoint commit **after every single tool call** — the most granular checkpoint strategy of any harness. This enables three restore options: files only, task (conversation) only, or both. The tradeoff is storage: on large repos, per-tool-call commits generate significant Git object overhead and can cause slowdowns.

### Aider — Git-as-Checkpoint

Aider takes the simplest approach: every file edit is automatically committed to the project's actual Git repository with a descriptive message. The `/undo` command reverts the last Aider commit. This means code changes always survive crashes, but conversation context does not — there's no session persistence across restarts. The `.aider.chat.history.md` file captures conversation history but can grow to 1M+ tokens and is not designed for programmatic restore.

### Devin — VM Snapshots + Timeline

Devin runs in persistent VM workspaces that "sleep" instead of ending after inactivity. A visual timeline lets operators navigate to any point in the session and restore both files and agent memory to that checkpoint. For multi-hour or multi-day tasks, Devin uses persistent memory and running TODO lists — essentially the agent maintains its own progress tracking files, similar to Anthropic's "effective harnesses" pattern.

### Gemini CLI — Shadow Git + Conversation Restore

Gemini CLI creates checkpoints automatically before file-modifying tools. Each checkpoint has three components: a Git snapshot in a shadow repo (`~/.gemini/history/`), conversation history as JSON, and the specific tool call being executed. The `/restore` command reverts files, reloads conversation history, **and** re-presents the original tool call for re-execution or modification. This is the most complete restore of any CLI harness — both Anthropic and Aider only restore one dimension (files or conversation, not both).

### The Pattern

Despite different implementations, all harnesses converge on the same core idea: **separate the checkpoint data from the execution engine**. Whether it's JSONL files, shadow Git repos, or VM snapshots, the checkpoint is always an external artifact that outlives the process. The execution engine reads the checkpoint on startup and writes to it after each meaningful operation.

---

## Framework Comparison

| Framework      | Approach                                 | Checkpoint Granularity  | Storage                  | Determinism Required? |
| -------------- | ---------------------------------------- | ----------------------- | ------------------------ | --------------------- |
| **LangGraph**  | Graph-based with automatic checkpointing | Per-node                | Memory, SQLite, Postgres | Yes (for replay)      |
| **Temporal**   | Replay-based durable execution           | Per-activity (implicit) | Temporal Server          | Yes (workflows)       |
| **Restate**    | Lightweight durable execution            | Per-step                | Restate Server           | No                    |
| **Inngest**    | Event-driven step functions              | Per-step                | Inngest Cloud            | No                    |
| **Google ADK** | Session-based state                      | Per-event               | Memory, DB, Vertex AI    | No                    |
| **Our demo**   | Explicit checkpoint-resume               | Per-item                | JSON files               | No                    |

LangGraph is closest to our approach — a state graph with checkpointing. The difference is that LangGraph checkpoints at the node level within a single graph execution, while our demo checkpoints at the item level across a batch of graph executions. LangGraph also supports replay-based resume (re-running the graph from the failed node), while we use skip-based resume (skipping completed items entirely).

Temporal and Restate operate at a different layer — they provide infrastructure-level durability, handling retries, timeouts, and state persistence as platform features. If your team already runs Temporal, wrapping agent activities in Temporal workflows gives you checkpointing "for free." If you don't, the operational overhead may not be worth it for a batch migration script.

---

## Key Takeaways

1. **Checkpoint after each meaningful unit of work.** For batch operations, that's usually per-item. For complex workflows, per-step. The right granularity balances durability against I/O overhead.

2. **Use atomic writes for checkpoint persistence.** Write-tmp-then-rename prevents corrupt checkpoints. This is a well-established pattern from databases and package managers.

3. **Make tools idempotent.** If a tool might be called again after a crash-and-resume, it must handle the "already done" case gracefully. Check-then-act, upserts, and idempotency keys.

4. **Separate execution from state.** The checkpoint is a plain data structure (JSON file, database row) that outlives the process. The execution engine reads it on startup, writes to it during operation.

5. **Design for graceful cancellation.** Use `AbortSignal`, not boolean flags. Finish the current unit of work before shutting down. Save a checkpoint on the way out.

6. **Compound errors make checkpointing essential, not optional.** At 90% per-step accuracy, a 10-step workflow succeeds only ~35% of the time. Being able to resume from step 8 instead of step 1 is the difference between "usable" and "unusable."

---

## Sources & Further Reading

- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) — graph-based checkpointing with multiple storage backends
- [Temporal — Durable Execution](https://temporal.io/how-it-works) — replay-based fault tolerance for workflows
- [Restate + Vercel AI SDK](https://restate.dev/blog/building-reliable-ai-agents-with-restate-and-the-vercel-ai-sdk/) — lightweight durable execution for AI agents
- [Anthropic — Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — multi-session harness architecture with progress tracking
- [Anthropic Agent SDK — File Checkpointing](https://platform.claude.com/docs/en/agent-sdk/file-checkpointing) — per-prompt file checkpoints with rewind
- [Google ADK — Sessions](https://google.github.io/adk-docs/sessions/session/) — event-based session state with managed persistence
- [Gemini CLI — Checkpointing](https://geminicli.com/docs/cli/checkpointing/) — shadow Git + conversation restore
- [OpenAI Agents SDK — Sessions](https://openai.github.io/openai-agents-python/sessions/) — 9 backend implementations with compaction
- [CORAL — Cognitive Resource Self-Allocation](https://openreview.net/forum?id=NBGlItueYE) — checkpoint-based episode resets for long-horizon agents
- [Fault-Tolerant Sandboxing for AI Coding Agents](https://arxiv.org/abs/2512.12806) — transactional approach with atomic rollback
- [JustCopy.ai — 10x More Reliable Agents](https://blog.justcopy.ai) — 86% reduction in lost work through persistent state machines
- [Grid Dynamics — LangGraph to Temporal Migration](https://temporal.io/resources-content/using-temporal-for-agentic-applications) — eliminating custom retry logic with durable execution
