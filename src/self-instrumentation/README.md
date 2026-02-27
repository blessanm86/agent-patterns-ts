# Observability for AI Agents — Adding OpenTelemetry to Your LLM Application

_Part of the [Agent Patterns — TypeScript](../../README.md) series. Builds on [ReAct (Reason+Act)](../react/README.md)._

---

When your agent gives a bad response, the first question is _why?_

Was it the wrong tool call? Did the model hallucinate a room price? Did Ollama take 12 seconds instead of 2? You can't answer any of these questions without observability — and `console.log` doesn't scale past the first debugging session.

Traditional APIs solved this decades ago with distributed tracing: every request gets a trace ID, every operation gets a span with timing and metadata, and you can reconstruct exactly what happened. The same primitives work for LLM agents. An agent invocation _is_ a request. An LLM call _is_ an operation. A tool execution _is_ an operation. The span hierarchy writes itself.

This post adds OpenTelemetry tracing to the ReAct hotel agent. Three span types, a custom console exporter, and a trace summary — all using the OTel GenAI semantic conventions that are becoming the industry standard.

---

## The Three Questions Every Trace Answers

Every agent trace answers three questions:

1. **How long did it take?** — Total duration and per-step timing. Was the bottleneck in Ollama or in a tool call?
2. **How many tokens did it use?** — Input and output token counts per LLM call, plus estimated cost. Where is the token budget going?
3. **What went wrong?** — Error attribution. Which specific span failed? What was the error message? What happened before it?

These are the same questions traditional APM answers for HTTP requests — except the "operations" are LLM calls and tool executions instead of database queries and API calls.

---

## Span Hierarchy

The instrumented agent creates a three-level span tree for every user message:

```
invoke_agent hotel-reservation         [SERVER — root span]
├── chat qwen2.5:7b                    [CLIENT — LLM call #1]
├── execute_tool check_availability    [INTERNAL — tool execution]
├── chat qwen2.5:7b                    [CLIENT — LLM call #2]
├── execute_tool get_room_price        [INTERNAL — tool execution]
├── chat qwen2.5:7b                    [CLIENT — LLM call #3]
└── ...
```

Each span type serves a different purpose:

| Span                  | Kind       | What It Captures                                       |
| --------------------- | ---------- | ------------------------------------------------------ |
| `invoke_agent`        | `SERVER`   | Total duration of the entire agent run                 |
| `chat {model}`        | `CLIENT`   | Per-call latency, token counts (in/out), finish reason |
| `execute_tool {name}` | `INTERNAL` | Tool execution time, success/failure status            |

The span kinds follow OTel conventions: `SERVER` for handling an inbound request (the user's message), `CLIENT` for calling an external service (Ollama), `INTERNAL` for in-process operations (tool execution).

**Key design decision:** Token counts go on individual `chat` spans, not on the root agent span. This is the universal pattern across OTel GenAI conventions, OpenLLMetry, Langfuse, and every major observability vendor. The agent span captures overall duration; LLM spans capture per-call token economics.

---

## OTel GenAI Semantic Conventions

The attributes recorded on each span follow the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) — the emerging industry standard for LLM observability. These conventions are currently in Development status, but are already adopted by OpenLLMetry (Traceloop), Datadog, Grafana, and others.

**On each `chat` span:**

```typescript
chatSpan.setAttributes({
  "gen_ai.operation.name": "chat",
  "gen_ai.system": "ollama",
  "gen_ai.request.model": MODEL,
  "gen_ai.usage.input_tokens": result.prompt_eval_count ?? 0,
  "gen_ai.usage.output_tokens": result.eval_count ?? 0,
  "gen_ai.response.finish_reasons": result.message.tool_calls ? "tool_calls" : "stop",
});
```

Ollama exposes token counts directly: `prompt_eval_count` for input tokens and `eval_count` for output tokens. Cloud providers expose these too — OpenAI uses `usage.prompt_tokens` / `usage.completion_tokens`, Anthropic uses `usage.input_tokens` / `usage.output_tokens`.

**On each `execute_tool` span:**

```typescript
toolSpan.setAttributes({
  "tool.name": name,
  "tool.status": "ok",
});
```

The OTel spec defines additional opt-in attributes like `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result`, but these are NOT populated by default because they may contain PII or large payloads. In production, enable them with the `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` environment variable for debugging only.

---

## The Custom Exporter

The built-in `ConsoleSpanExporter` dumps raw JSON — trace IDs, `[seconds, nanoseconds]` tuples, and resource metadata. Fine for debugging OTel itself, terrible for watching an agent run.

Instead, we write a `PrettyConsoleExporter` that prints one readable line per span:

```
  [TRACE] chat qwen2.5:7b (1,891ms, 512 in / 89 out, tool_calls)
  [TRACE] execute_tool check_availability (2ms, ok)
  [TRACE] chat qwen2.5:7b (1,102ms, 643 in / 124 out, stop)
[TRACE] invoke_agent hotel-reservation (3,247ms total)
```

The exporter implements the `SpanExporter` interface — just three methods:

```typescript
class PrettyConsoleExporter implements SpanExporter {
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      // Format depends on span type: LLM call, tool call, or agent root
      const durationMs = hrTimeToMs(span.duration);
      const hasParent = span.parentSpanId !== undefined;
      const indent = hasParent ? "  " : "";
      // ... print formatted line
    }
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
```

The indent logic is simple: child spans (those with a `parentSpanId`) get indented. The root agent span prints flush-left. This creates a visual hierarchy without needing the full trace waterfall.

---

## The Trace Summary Collector

A second exporter silently accumulates metrics. After each agent run, it provides an aggregated summary:

```
  ── Trace Summary ──────────────────────────────────────────
  Duration:    3,247ms
  LLM calls:   2  |  Tool calls: 1
  Tokens:      1,368 (1,155 in + 213 out)
  Est. cost:   $0.0067 (at GPT-4o pricing)
  ──────────────────────────────────────────────────────────
```

**Cost estimation** is a derived metric — the OTel spec doesn't define a `gen_ai.cost` attribute. We calculate it from token counts using GPT-4o pricing as a reference ($2.50 / 1M input tokens, $10.00 / 1M output tokens). Ollama is free locally, but showing estimated cost helps developers understand what production would cost.

| Model             | Input (per 1M tokens) | Output (per 1M tokens) | Source                |
| ----------------- | --------------------- | ---------------------- | --------------------- |
| Ollama (local)    | $0                    | $0                     | Your electricity bill |
| GPT-4o            | $2.50                 | $10.00                 | OpenAI pricing        |
| Claude Sonnet 4.5 | $3.00                 | $15.00                 | Anthropic pricing     |
| GPT-4.1           | $2.00                 | $8.00                  | OpenAI pricing        |

Both exporters attach via `SimpleSpanProcessor` — spans export immediately, not batched. This is essential for a dev demo where you want to see traces inline with agent output. In production, use `BatchSpanProcessor` to avoid blocking the application on export.

---

## `startActiveSpan` and Context Propagation

The tracer is passed into `runAgent()` via dependency injection — the agent code doesn't depend on the specific tracing setup.

```typescript
export async function runAgent(
  userMessage: string,
  history: Message[],
  tracer: Tracer,
): Promise<Message[]> {
  return tracer.startActiveSpan(
    "invoke_agent hotel-reservation",
    { kind: SpanKind.SERVER },
    async (agentSpan) => {
      // ... ReAct loop with nested spans
    },
  );
}
```

`startActiveSpan` is the key: it sets the span as active in the current async context. Any `startActiveSpan` called inside the callback automatically becomes a child — no manual context passing. The span hierarchy emerges from the call hierarchy:

```typescript
// Inside the while(true) ReAct loop:

// This becomes a child of invoke_agent automatically
const response = await tracer.startActiveSpan(
  `chat ${MODEL}`,
  { kind: SpanKind.CLIENT },
  async (chatSpan) => {
    const result = await ollama.chat({ model: MODEL, messages, tools });
    // Set attributes after the call completes
    chatSpan.setAttributes({
      /* token counts, finish reason */
    });
    chatSpan.end();
    return result;
  },
);

// This also becomes a child of invoke_agent
tracer.startActiveSpan(`execute_tool ${name}`, { kind: SpanKind.INTERNAL }, (toolSpan) => {
  const result = executeTool(name, args);
  toolSpan.end();
});
```

**Rule: every span MUST be ended.** Unended spans leak memory and won't be exported. The `try/catch/finally` pattern ensures `span.end()` always runs:

```typescript
try {
  // ... do work, set attributes on success
  chatSpan.setStatus({ code: SpanStatusCode.OK });
} catch (error) {
  chatSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  throw error;
} finally {
  chatSpan.end(); // Always runs
}
```

---

## Running the Demo

```bash
pnpm dev:self-instrumentation
```

### Commands

| Command  | Effect                                                |
| -------- | ----------------------------------------------------- |
| `/trace` | Reprint the last trace summary                        |
| `/reset` | Clear conversation history, mock data, and trace data |

### Try This

1. Ask: `"I'd like to book a double room from 2026-03-01 to 2026-03-05"`
   - Watch the trace lines print inline as the agent runs
   - See the summary with token counts and estimated cost

2. Ask a follow-up: `"Actually, make that a suite"`
   - Notice input tokens growing (conversation history gets longer)
   - Use `/trace` to review the summary again

3. Use `/reset` and ask a simple question: `"Hello!"`
   - Only 1 LLM call, 0 tool calls — the simplest possible trace

### Example Output

```
You: How much does a suite cost for 3 nights?

  🔧 Tool call: get_room_price
     Args: { "room_type": "suite", "nights": "3" }
     Result: {"room_type":"suite","pricePerNight":350,"nights":3,"totalPrice":1050,"currency":"USD"}
  [TRACE] chat qwen2.5:7b (2,341ms, 487 in / 62 out, tool_calls)
  [TRACE] execute_tool get_room_price (0ms, ok)
  [TRACE] chat qwen2.5:7b (1,876ms, 598 in / 91 out, stop)
[TRACE] invoke_agent hotel-reservation (4,220ms total)

──────────────────────────────────────────────────────

Agent: A suite costs $350 per night. For 3 nights, the total would be $1,050.

  ── Trace Summary ──────────────────────────────────────────────────
  Duration:    4,220ms
  LLM calls:   2  |  Tool calls: 1
  Tokens:      1,238 (1,085 in + 153 out)
  Est. cost:   $0.0042 (at GPT-4o pricing)
  ──────────────────────────────────────────────────────────────────
```

---

## SimpleSpanProcessor vs BatchSpanProcessor

This demo uses `SimpleSpanProcessor` — spans export synchronously, immediately when they end. This is important for the demo because traces print inline alongside agent output.

In production, use `BatchSpanProcessor`:

```typescript
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

new BatchSpanProcessor(new OTLPTraceExporter({ url: "http://localhost:4318/v1/traces" }));
```

|                    | SimpleSpanProcessor      | BatchSpanProcessor                       |
| ------------------ | ------------------------ | ---------------------------------------- |
| **Export timing**  | Immediately on span end  | Batched (default: every 5s or 512 spans) |
| **Blocks app**     | Yes (synchronous export) | No (async background export)             |
| **Best for**       | Dev, demos, debugging    | Production                               |
| **Data loss risk** | None (always exports)    | Minimal (buffer flushed on shutdown)     |

For visual trace exploration in production, export to Jaeger (supports OTLP natively since v1.35+):

```bash
docker run -d --name jaeger \
  -p 16686:16686 -p 4318:4318 \
  jaegertracing/jaeger:latest
```

Then open `http://localhost:16686` for a full waterfall UI.

---

## Key Takeaways

1. **Three span types are enough.** `invoke_agent` (root), `chat` (LLM calls), `execute_tool` (tools). Token counts go on `chat` spans, total duration on the root. This hierarchy is the universal pattern across OTel GenAI conventions and every major observability vendor.

2. **`startActiveSpan` handles parent-child relationships automatically.** No manual context propagation. Nest the calls, and the span hierarchy follows the call hierarchy.

3. **Cost is a derived metric.** The OTel spec doesn't define it. Calculate from `(input_tokens * input_price) + (output_tokens * output_price)`. Show it even when using free local models — developers need to understand production costs.

4. **Don't log prompt/response content by default.** The OTel spec is explicit: input/output messages are "likely to contain sensitive information including user/PII data." Use opt-in attributes for debugging only.

5. **Use `SimpleSpanProcessor` for dev, `BatchSpanProcessor` for production.** The difference is synchronous vs async export. In dev you want immediate output; in production you want non-blocking throughput.

---

## Sources & Further Reading

### OpenTelemetry Official

- [GenAI Semantic Conventions Overview](https://opentelemetry.io/docs/specs/semconv/gen-ai/) — the emerging standard for LLM observability attributes
- [GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/) — span conventions for agent execution (`invoke_agent`, `create_agent`)
- [GenAI Client Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) — span conventions for inference, embeddings, retrieval, tool execution
- [GenAI Metrics](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/) — histogram definitions for token usage, latency, TTFT
- [OpenTelemetry for Generative AI](https://opentelemetry.io/blog/2024/otel-generative-ai/) — OTel blog announcing the GenAI SIG and semantic conventions
- [AI Agent Observability — Evolving Standards and Best Practices](https://opentelemetry.io/blog/2025/ai-agent-observability/) — 2025 update on the GenAI SIG's progress
- [Node.js Getting Started](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/) — OTel SDK setup for Node.js

### Tools & Libraries

- [OpenLLMetry](https://github.com/traceloop/openllmetry) — Traceloop — open-source OTel instrumentation for LLM providers (contributed the original GenAI semantic conventions)
- [Langfuse](https://langfuse.com/docs/observability/overview) — open-source LLM observability platform with tracing, evals, and prompt management

### Practitioner Experience

- [VictoriaMetrics: AI Agents Observability with OpenTelemetry](https://victoriametrics.com/blog/ai-agents-observability/) — practical dashboard design and metric selection
- [Traceloop: Visualizing LLM Performance with OpenTelemetry](https://www.traceloop.com/blog/visualizing-llm-performance-with-opentelemetry-tools-for-tracing-cost-and-latency) — token usage and cost tracking patterns
- [Greptime: Agent Observability](https://www.greptime.com/blogs/2025-12-11-agent-observability) — "Can the old playbook handle the new game?" — anti-patterns and data volume challenges
- [Grafana: Complete Guide to LLM Observability with OpenTelemetry](https://grafana.com/blog/a-complete-guide-to-llm-observability-with-opentelemetry-and-grafana-cloud/) — end-to-end production setup

### Academic

- [AgentOps: Enabling Observability of LLM Agents](https://arxiv.org/pdf/2411.05285) — 2024 — argues for specialized agent observability beyond traditional APM
- [Taming Uncertainty via Automation](https://arxiv.org/html/2507.11277v1) — 2025 — proposes a 6-stage AgentOps pipeline (Observe → Collect → Detect → Root Cause → Optimize → Automate)
