# Two Returns, One Tool — How to Feed Your LLM Less and Get Better Results

[Agent Patterns — TypeScript](../../README.md) · Concept 15 of 20

> **Previous concept:** [Tool Description Engineering](../tool-descriptions/README.md) — writing tool descriptions that coach the model on when, why, and how to call each tool. This concept tackles what comes back from those tool calls, because most of that data never needed to enter the LLM's context in the first place.

---

Your monitoring agent calls `get_error_logs` and gets back 50 log entries — timestamps, trace IDs, severity levels, full error messages. That's roughly 4,000 tokens dumped into the LLM's context window. The LLM reads every token, thinks for a moment, and responds: "The checkout-service has the most errors, primarily connection timeouts to the payment gateway."

It read 4,000 tokens to produce a count and a category.

Meanwhile, your UI needs the full data to render a filterable error table. But the UI doesn't get a separate copy — it has to parse the LLM's natural language response and hope it mentioned everything important.

One return channel, two consumers with completely different needs.

## The Problem: Stuffing Everything Into Content

The standard tool return looks like this:

```
┌──────────────────────────────────────────┐
│ Tool: get_error_logs("checkout-service") │
├──────────────────────────────────────────┤
│                                          │
│   { role: "tool",                        │
│     content: "[                          │
│       { timestamp: '08:01:12',           │
│         service: 'checkout-service',     │
│         severity: 'error',              │
│         message: 'Connection timeout     │
│           to payment-gateway...',        │
│         traceId: 'trc-a001' },           │
│       { timestamp: '08:01:45', ... },    │
│       ... 48 more entries ...            │
│     ]"                                   │
│   }                                      │
│                                          │
│   ~4,000 tokens into LLM context        │
│                                          │
└──────────────────────────────────────────┘
```

Every byte of that JSON goes into the LLM's context window. The model processes all of it during attention computation. You're paying for tokens the model doesn't need, and those tokens actually make the response worse — the LLM has to sift through noise to find the signal.

Anthropic's documentation on tool result management calls this "the safest, lightest-touch form of compaction" — clearing tool results that have already been processed. But you can do even better: never put the full data in context in the first place.

## The Pattern: Content + Artifact

Split the tool return into two channels:

```
┌──────────────────────────────────────────┐
│ Tool: get_error_logs("checkout-service") │
├──────────────────────────────────────────┤
│                                          │
│   CONTENT → LLM context                 │
│   "23 errors for checkout-service.       │
│    Top: 'Connection timeout' (12x),      │
│    'Cart serialize failed' (5x),         │
│    'Circuit breaker OPEN' (3x)"          │
│   ~40 tokens                             │
│                                          │
│   ARTIFACT → UI rendering                │
│   { type: "table",                       │
│     title: "Error Logs",                 │
│     data: [ ...all 50 entries... ] }     │
│   ~4,000 tokens (never enters context)   │
│                                          │
└──────────────────────────────────────────┘
```

The LLM gets a 40-token summary with the key facts: counts, top error categories, severity breakdown. That's everything it needs to give a useful response.

The UI gets the full structured data with a rendering hint (`"table"`). It renders the error table directly from the artifact — no LLM parsing required.

## Implementation

### The DualReturn Type

```typescript
interface DualReturn {
  content: string; // concise summary → LLM context
  artifact: ToolArtifact | null; // full data → UI rendering
}

interface ToolArtifact {
  type: "table" | "json" | "list"; // rendering hint
  title: string;
  data: unknown;
}
```

Every tool returns this shape. `content` is what the LLM sees. `artifact` is what the UI renders. When a tool has nothing worth rendering (e.g., "no results found"), `artifact` is null.

### Writing Content Summaries

The content string is where the design work happens. Each tool needs a summary that gives the LLM enough to reason without drowning it in detail:

```typescript
function getErrorLogs(args): DualReturn {
  const logs = ERROR_LOGS.filter((e) => e.service === args.service);

  // Group errors by message to find patterns
  const counts = {};
  for (const log of logs) {
    counts[log.message] = (counts[log.message] ?? 0) + 1;
  }

  const topErrors = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([msg, count]) => `'${msg}' (${count}x)`)
    .join("; ");

  return {
    content: `${logs.length} log entries for ${args.service}. ` + `Top errors: ${topErrors}`,
    artifact: {
      type: "table",
      title: `Error Logs — ${args.service}`,
      data: logs, // full data for the UI
    },
  };
}
```

Key content design principles:

- **Counts over lists** — "23 errors" not a list of 23 errors
- **Top-N patterns** — surface the most frequent items, not all items
- **Severity breakdown** — "3 critical, 12 error, 8 warning" tells the LLM the urgency
- **Enough to answer follow-ups** — if the user asks "what's the main issue?", the content should be sufficient

### The Mode-Aware Dispatcher

The same tool implementations serve both modes. A `mode` parameter controls how the return is formatted:

```typescript
function executeTool(name, args, mode: "simple" | "dual"): DualReturn {
  const result = toolImplementation(name, args);

  if (mode === "simple") {
    // Naive mode: full data as content, no artifact
    return {
      content: JSON.stringify(result.artifact?.data, null, 2),
      artifact: null,
    };
  }

  return result; // Dual mode: concise content + artifact
}
```

This lets you A/B test the pattern directly: run the same prompts in both modes and compare token usage, response quality, and latency.

### The Agent Loop: Side Channel for Artifacts

The ReAct loop is almost identical to the standard pattern. The one change: artifacts accumulate in a parallel array instead of entering the message history.

```typescript
async function runAgent(userMessage, history, mode): Promise<AgentResult> {
  const messages = [...history, { role: "user", content: userMessage }];
  const artifacts: ArtifactEntry[] = [];

  while (iterations < MAX_ITERATIONS) {
    const response = await ollama.chat({ model, messages, tools });
    // ...

    for (const toolCall of assistantMessage.tool_calls) {
      const { content, artifact } = executeTool(name, args, mode);

      // Only content enters the LLM's context
      messages.push({ role: "tool", content });

      // Artifact goes to the side channel
      if (artifact) {
        artifacts.push({ toolName: name, artifact, tokensSaved });
      }
    }
  }

  return { messages, artifacts, tokenStats };
}
```

The LLM never knows artifacts exist. It operates on the concise content summaries and produces its response. The UI receives both the LLM's response text and the artifact array, rendering them in separate panels.

## The Numbers

Here's what happens with a typical monitoring query ("What services are having issues? Show me error logs for the worst one."):

| Tool Call        | Simple Mode (tokens) | Dual Mode (tokens) | Savings |
| ---------------- | -------------------- | -----------------: | ------: |
| `list_services`  | ~420                 |                ~65 |     84% |
| `get_error_logs` | ~3,800               |                ~55 |     99% |
| `get_metrics`    | ~280                 |                ~50 |     82% |
| `get_incidents`  | ~950                 |                ~60 |     94% |
| **Total**        | **~5,450**           |           **~230** | **96%** |

The LLM processes 230 tokens instead of 5,450 — a 96% reduction. The response quality doesn't degrade because the summaries contain the key facts the model needs: counts, top errors, severity levels, status breakdowns.

## Running the Demo

```bash
# Dual return mode (default) — concise LLM context + artifact panels
pnpm dev:dual-return

# Simple mode — all data dumped into LLM context
pnpm dev:dual-return:simple
```

Try the same prompts in both modes:

- "What services are having issues?"
- "Show me error logs for checkout-service"
- "What are the current incidents?"
- "Give me metrics for the payment gateway"

In dual mode, you'll see artifact panels rendered below the agent's response, plus token stats showing the savings. In simple mode, the same data goes into the LLM's context — watch the token counts climb.

## When to Use This Pattern

**Use dual return when:**

- Tool results are large structured data (tables, log sets, metric snapshots)
- The LLM needs a summary to reason, not the full dataset
- Your UI can render structured data directly (tables, charts, cards)
- Token cost or context window pressure is a concern

**Skip it when:**

- Tool results are already concise (a single record lookup, a boolean check)
- The LLM genuinely needs every detail (e.g., a diff review, a code analysis)
- There's no UI consumer — if it's a CLI that only shows the LLM's text, artifacts go nowhere

## Relationship to Other Patterns

This pattern sits at the intersection of two concerns:

- **[Context Window Management](../context-management/README.md)** addresses the same token pressure problem from a different angle — what to do when the conversation grows too long. Dual return prevents the growth in the first place by never injecting unnecessary data. These are complementary: use dual return to keep tool results lean, and context management to handle the conversation history that accumulates over many turns.

- **Observation masking** (covered in concept 6) clears tool results _after_ the LLM has already processed them. Dual return is more efficient — the full data never enters the context at all. Think of it as "observation masking at the source."

## Key Takeaways

1. **One return channel, two consumers is the root problem.** The LLM needs a summary. The UI needs the full data. Forcing both through `content` wastes tokens and degrades both experiences.

2. **Content design is the hard part.** The summary needs enough information for the LLM to reason accurately — counts, top-N items, severity breakdowns, key patterns — without reproducing the full dataset.

3. **The savings are dramatic.** 90-99% token reduction on data-heavy tool results is typical. That translates directly to lower latency, lower cost, and better response quality (less noise for the model to process).

4. **It's backwards-compatible.** The agent loop barely changes — just split the return and route artifacts to a side channel. Existing tools can be migrated one at a time.

---

**Sources:**

- [LangChain — How to return artifacts from a tool](https://python.langchain.com/docs/how_to/tool_artifacts/) — defines `response_format="content_and_artifact"` and the two-tuple return convention
- [Improving core tool interfaces and docs in LangChain](https://blog.langchain.com/improving-core-tool-interfaces-and-docs-in-langchain/) — explains the motivation: large tool outputs inflate context
- [Claude Artifacts](https://www.anthropic.com/news/artifacts) — UI-level instantiation of separating conversation content from rendered artifacts
- [Anthropic — Prompt Caching and Context Windows](https://docs.anthropic.com/en/docs/build-with-claude/context-windows) — tool result clearing as "the safest, lightest-touch form of compaction"
