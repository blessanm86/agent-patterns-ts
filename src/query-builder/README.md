# Don't Let Your LLM Write Queries — The Query Builder Pattern

Your LLM writes monitoring queries like a junior dev on their first on-call shift — with typos, missing quotes, and syntax that _almost_ works. And when your dashboards are down at 3 AM, "almost" isn't good enough.

Research on text-to-SQL puts raw LLM query generation error rates at **37% or higher** (Spider benchmark, Yu et al. 2018). Structured approaches — where the LLM fills parameters and code constructs the query — improve accuracy 3-27x depending on the domain. The query builder pattern applies this insight to any query language: SQL, PromQL, MetricsQL, Elasticsearch, or your own DSL.

> Part of [Agent Patterns — TypeScript](../../README.md). Builds on the tool-calling patterns from the [ReAct loop](../react/README.md) and the structured parameter approach from [Tool Description Engineering](../tool-descriptions/README.md).

---

## The Problem: LLMs and Query Syntax Don't Mix

Give an LLM a free-text query tool and watch what happens:

```
User: "How many 500 errors has checkout-service returned?"

LLM writes: http_requests{svc="checkout-service", status=500} | count [1h]
                          ^^^                           ^^^
                     Wrong label name              Unquoted value
```

Three syntax errors in one query. The metric name is truncated (`http_requests` instead of `http_requests_total`), the label name is wrong (`svc` instead of `service`), and the value isn't quoted. A real monitoring system rejects this silently or — worse — returns empty results that the LLM interprets as "no errors."

Common failure modes with raw query generation:

| Failure             | Example                                               | Frequency   |
| ------------------- | ----------------------------------------------------- | ----------- |
| Wrong metric name   | `http_requests` instead of `http_requests_total`      | Very common |
| Invalid label name  | `svc` instead of `service`                            | Common      |
| Missing quotes      | `status=500` instead of `status="500"`                | Common      |
| Wrong separator     | `sum http_requests` instead of `http_requests \| sum` | Common      |
| Invalid aggregation | `average` instead of `avg`                            | Occasional  |
| Missing brackets    | `1h` instead of `[1h]`                                | Occasional  |

The LLM _knows_ what it wants to query. It just can't reliably express it in the right syntax.

---

## The Pattern: Structured Parameters → Server-Side Construction

Instead of giving the LLM a text box and hoping for valid syntax, give it a form:

```
┌─────────────────────────────────────────────────┐
│                  RAW MODE                        │
│                                                  │
│  LLM writes:                                     │
│  "http_requests{svc=checkout} | average [1h]"   │
│        │                                         │
│        ▼                                         │
│  Parser: ❌ Unknown label 'svc'                  │
│  Parser: ❌ Unquoted value                       │
│  Parser: ❌ Unknown aggregation 'average'        │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│               BUILDER MODE                       │
│                                                  │
│  LLM fills structured params:                    │
│  {                                               │
│    metric: "http_requests_total",    ← enum      │
│    aggregation: "avg",               ← enum      │
│    filters: [{                                   │
│      label: "service",               ← validated │
│      op: "eq",                       ← enum      │
│      value: "checkout-service"                   │
│    }],                                           │
│    time_range: "1h"                  ← enum      │
│  }                                               │
│        │                                         │
│        ▼                                         │
│  Builder: ✅ Valid query constructed             │
│  → http_requests_total{service="checkout-       │
│    service"} | avg [1h]                          │
└─────────────────────────────────────────────────┘
```

The builder validates each field against known enums and schemas. Metric names, aggregations, and time ranges are constrained. Labels are checked against the metric's schema. The LLM can't produce invalid syntax because it never writes syntax — it fills in fields.

---

## Implementation

This demo builds a **metrics monitoring agent** with two modes:

- **Raw mode** (`--raw`): The LLM writes MetricsQL query strings directly
- **Builder mode** (default): The LLM fills structured parameters, code constructs the query

Both modes query the same mock dataset of 8 microservices.

### The Query Engine

Five metrics with typed label sets:

```typescript
// query-engine.ts
export const METRICS: MetricSchema[] = [
  {
    name: "http_requests_total",
    labels: ["service", "method", "status", "endpoint"],
  },
  {
    name: "http_request_duration_ms",
    labels: ["service", "method", "endpoint"],
  },
  {
    name: "error_rate",
    labels: ["service", "error_type"],
  },
  // ... memory_usage_bytes, cpu_usage_percent
];
```

### Raw Tool: Free-Text Query String

The raw tool gives the LLM a single `query` parameter:

```typescript
// tools.ts — raw tool
{
  name: "query_raw",
  parameters: {
    query: {
      type: "string",
      description: "The MetricsQL query string..."
    }
  }
}
```

A strict parser validates the syntax:

```typescript
// query-engine.ts — parseRawQuery()
export function parseRawQuery(queryStr: string): QueryResult {
  // Step 1: Extract and validate metric name
  // Step 2: Parse label selector {label="value"}
  // Step 3: Parse aggregation after '|'
  // Step 4: Parse optional group_by
  // Step 5: Parse optional time range [1h]
  // Every step produces clear error messages:
  // "Unknown metric 'http_requests'. Did you mean 'http_requests_total'?"
  // "Label values must be quoted: service=\"api-gateway\""
  // "Unknown aggregation 'average'. Did you mean 'avg'?"
}
```

### Builder Tool: Structured Parameters

The builder tool uses enums and typed fields:

```typescript
// tools.ts — builder tool
{
  name: "query_metrics",
  parameters: {
    metric:      { type: "string", enum: ["http_requests_total", ...] },
    aggregation: { type: "string", enum: ["count", "sum", "avg", ...] },
    filters:     { type: "string", description: "JSON array of filters" },
    group_by:    { type: "string" },
    time_range:  { type: "string", enum: ["5m", "15m", "1h", "6h", "24h"] }
  }
}
```

The builder function validates and constructs:

```typescript
// query-engine.ts — buildQuery()
export function buildQuery(params: BuilderQuery): QueryResult {
  // Validate metric exists (enum already constrains this)
  // Validate filters reference valid labels for this metric
  // Validate group_by is a valid label
  // Construct query string → execute
}
```

The key difference: with enums in the tool schema, the LLM _can't_ send `"average"` — it's constrained to `"avg"`. It _can't_ send `"http_requests"` — only the full metric names are valid. The builder eliminates an entire class of errors at the schema level.

### The Agent Loop

Standard ReAct pattern with query stats tracking:

```typescript
// agent.ts
const queryStats: QueryStats = {
  totalQueries: 0,
  successfulQueries: 0,
  failedQueries: 0,
  errors: [],
};

// After each tool call:
if (queryResult) {
  queryStats.totalQueries++;
  if (queryResult.success) {
    queryStats.successfulQueries++;
  } else {
    queryStats.failedQueries++;
    queryStats.errors.push(queryResult.error);
  }
}
```

---

## Running the Demo

```bash
# Builder mode (default) — structured parameters
pnpm dev:query-builder

# Raw mode — LLM writes query strings
pnpm dev:query-builder:raw
```

Try the same prompts in both modes:

- "How many HTTP requests is the api-gateway handling?"
- "What is the p99 latency for checkout-service by method?"
- "Show me error rates for payment-gateway"
- "Which service has the highest CPU usage?"

In builder mode, queries succeed on the first attempt. In raw mode, you'll often see the LLM retry after syntax errors — sometimes successfully, sometimes not.

---

## When to Use Each Approach

**Use the builder pattern when:**

- Query syntax is complex (SQL, PromQL, custom DSLs)
- Errors are costly (production dashboards, alerting, billing)
- The query domain is bounded (known metrics, known labels)
- You need injection prevention

**Use raw query strings when:**

- The syntax is simple and well-known (basic filters, key-value lookups)
- Flexibility matters more than reliability (exploratory analysis)
- The domain is open-ended (users defining their own schemas)

**Hybrid approach:** Builder for common patterns, with a raw escape hatch for advanced users. The builder handles 90% of queries safely; the raw tool handles the 10% that need full flexibility.

---

## The Injection Prevention Bonus

The builder pattern prevents query injection as a side effect. When the LLM fills structured parameters, there's no way to inject malicious syntax:

```
// Raw mode — injection possible:
query: "http_requests_total{} | count [1h]; DROP TABLE metrics"

// Builder mode — injection impossible:
metric: "http_requests_total"  // validated against enum
aggregation: "count"            // validated against enum
// No free-text field that could contain injection payloads
```

This matters less for monitoring queries and more for SQL, GraphQL, or any query language where injection is a real threat.

---

## Key Takeaways

1. **LLMs are bad at syntax, good at semantics.** They know _what_ to query but struggle with _how_ to express it. The builder pattern separates intent (LLM's job) from syntax (code's job).

2. **Enums are your best friend.** Every field that can be an enum should be an enum. The tool schema becomes a constraint that prevents errors before they happen.

3. **Structured parameters are a form of type safety.** Just as TypeScript prevents `string` where you need `number`, tool schemas prevent `"average"` where you need `"avg"`.

4. **The error rates are dramatic.** Raw query generation fails often enough to be unreliable in production. Structured builders fail only on semantic issues (querying a label that doesn't exist on a metric), not syntax.

5. **Injection prevention is free.** When the LLM never writes raw query strings, injection attacks become structurally impossible.

---

_Next up: [Structured Entity Tags](../entity-tags/README.md) — making LLM output interactive by embedding clickable entity references._
