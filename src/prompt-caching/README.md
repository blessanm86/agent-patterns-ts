# The Cheapest Optimization You're Not Using — Prompt Caching

[Agent Patterns — TypeScript](../../README.md) · Concept 11 of 20

> **Previous concept:** [RAG](../rag/README.md) — grounding answers in retrieved documentation. This concept shifts from _what_ goes into the prompt to _how efficiently_ that prompt gets processed, because most of your prompt is identical on every request.

---

Every request to your agent re-processes the same system prompt and tool definitions from scratch. Your 2000-token system prompt with company policies, 12 tool definitions with detailed descriptions, the conversation prefix — all of it gets turned into key-value vectors every single time.

Prompt caching stops paying that tax. The first request computes those vectors and stores them. Every subsequent request skips the computation and reads directly from cache. The result: 50-90% less latency on the prompt evaluation step, and significantly lower cost on cloud providers.

## What Gets Cached

An agent prompt has a stable prefix (identical every request) and a dynamic suffix (changes every request):

```
┌─────────────────────────────────────────────────┐
│ STABLE PREFIX (cached)                          │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ System prompt                               │ │
│ │ "You are a customer support agent for..."   │ │
│ │ Company policies, tone guidelines,          │ │
│ │ escalation procedures (~2000 tokens)        │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ Tool definitions                            │ │
│ │ 12 tools × ~100 tokens each = ~1200 tokens │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ Conversation history prefix                 │ │
│ │ Earlier turns that don't change             │ │
│ └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ DYNAMIC SUFFIX (not cached)                     │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ Latest user message                         │ │
│ │ "What's the status of order ORD-001?"       │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

The key insight: caching works on **prefixes**. The stable content must come first, and it must be **byte-identical** across requests. Any difference — even a single character — invalidates the cache from that point forward.

## Under the Hood: KV-Cache Prefix Reuse

To understand prompt caching, you need to know how transformers process prompts.

### How transformers compute prompts

Every token in the prompt gets transformed into three vectors: **Query (Q)**, **Key (K)**, and **Value (V)**. The attention mechanism uses Q to "look at" all the K vectors and produce a weighted sum of V vectors. This Q/K/V computation is the expensive part — it scales quadratically with prompt length.

```
Token "You"    →  K₁, V₁
Token "are"    →  K₂, V₂
Token "a"      →  K₃, V₃
Token "support"→  K₄, V₄
...
Token "agent"  →  Kₙ, Vₙ

This is the "prefill" step — evaluating the prompt.
```

### Why identical prefixes produce identical KV values

Here's the critical property: for any given model, the same sequence of input tokens **always** produces the same K and V vectors. This is deterministic — no randomness in the prefill step (temperature only affects token sampling during generation).

This means if two requests share the same first 3000 tokens, the K/V vectors for those 3000 tokens are identical. Computing them twice is pure waste.

### KV-cache prefix sharing

The KV-cache stores computed K and V vectors in GPU memory. On a cache hit:

```
Request 1: Compute K,V for tokens 1-3000 (system + tools)
            Compute K,V for tokens 3001-3050 (user message)
            Store K,V[1:3000] in cache

Request 2: Load K,V[1:3000] from cache     ← SKIP computation
            Compute K,V for tokens 3001-3060 (different user message)
```

The metric that reveals this: **`prompt_eval_count`** in Ollama's response. On a cache hit, this number drops to just the new tokens beyond the cached prefix. On a miss, it equals the full prompt length.

This is the same mechanism that underlies [PagedAttention](https://arxiv.org/abs/2309.06180) (vLLM) and all cloud provider prompt caching features — the math is identical, only the API differs.

## The Demo

Our benchmark runs a customer support agent with a large system prompt (~2000 tokens of company policies) and 12 tool definitions. It sends 5 questions in two phases:

**Phase 1 — Stable prefix:** Same system prompt every request. Ollama can reuse the KV-cache.

**Phase 2 — Rotating prefix:** System prompt changes slightly each request (appended policy version). Cache is invalidated.

```bash
pnpm dev:prompt-caching
```

### What to look for in the output

The benchmark prints `prompt_eval_count` and `prompt_eval_duration` for each request. In the stable prefix phase:

- **Request 1**: Full prompt evaluation (cache cold) — high `prompt_eval_count`
- **Requests 2-5**: Partial evaluation (cache warm) — lower `prompt_eval_count`, only new tokens evaluated

In the rotating prefix phase, every request shows high `prompt_eval_count` because the changed suffix invalidates the cache.

### Measuring cache effectiveness

```typescript
// Ollama returns timing metadata on every response
const response = await ollama.chat({
  model: MODEL,
  system: SYSTEM_PROMPT, // ~2000 tokens, identical every request
  messages,
  tools, // 12 tools, identical every request
});

// These fields reveal cache behavior:
response.prompt_eval_count; // tokens evaluated in prefill
response.prompt_eval_duration; // time spent on prefill (nanoseconds)
response.eval_count; // response tokens generated
response.eval_duration; // time spent generating (nanoseconds)
```

When the KV-cache hits, `prompt_eval_count` drops because Ollama only evaluates the tokens beyond the cached prefix.

## Provider APIs

Each cloud provider implements prompt caching differently. Here's how you'd use each one.

### Anthropic — Explicit cache control

Anthropic gives you fine-grained control with `cache_control` breakpoints. You mark exactly where the cacheable prefix ends:

```typescript
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: LARGE_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" }, // ← cache this block
    },
  ],
  tools: tools.map((tool, i) => ({
    ...tool,
    // Cache breakpoint on the LAST tool definition
    ...(i === tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  })),
  messages: [{ role: "user", content: userQuestion }],
});

// Response headers reveal cache behavior:
// response.usage.cache_creation_input_tokens — tokens written to cache
// response.usage.cache_read_input_tokens     — tokens read from cache
```

**Pricing:** Cache writes cost 25% more than normal input. Cache reads cost **90% less**. Cache TTL is 5 minutes (extended on each hit). Minimum cacheable prefix: 1024 tokens (Sonnet/Haiku) or 2048 tokens (Opus).

### OpenAI — Automatic caching

OpenAI caches automatically — no code changes needed:

```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: LARGE_SYSTEM_PROMPT },
    { role: "user", content: userQuestion },
  ],
  tools: toolDefinitions,
});

// Check usage for cache hits:
// response.usage.prompt_tokens_details.cached_tokens
```

**Pricing:** Cached tokens cost 50% less than normal input. No write premium. Minimum prefix: 1024 tokens. Cache persists for 5-10 minutes of inactivity.

### Google Gemini — Managed cache objects

Gemini uses explicit cache objects with configurable TTL:

```typescript
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Create a cache object (persists across requests)
const cache = await ai.caches.create({
  model: "gemini-1.5-pro",
  config: {
    contents: [{ role: "user", parts: [{ text: LARGE_SYSTEM_PROMPT }] }],
    ttl: "3600s", // 1 hour TTL
  },
});

// Use the cache in requests
const response = await ai.models.generateContent({
  model: "gemini-1.5-pro",
  contents: userQuestion,
  config: { cachedContent: cache.name },
});
```

**Pricing:** Cached tokens cost 75% less than normal input. No write premium. TTL is configurable (minimum 1 minute). Minimum: 32,768 tokens for Gemini 1.5 Pro.

## Cost Math

Here's a worked example. A customer support agent with:

- **Prefix**: 3000 tokens (system prompt + 12 tool definitions)
- **Per request**: ~50 input tokens (user message) + ~100 output tokens
- **Volume**: 1000 requests

| Provider                      | Without Cache                  | With Cache                     | Savings       |
| ----------------------------- | ------------------------------ | ------------------------------ | ------------- |
| Anthropic (Claude 3.5 Sonnet) | $0.0090 input + $0.0015 output | $0.0010 input + $0.0015 output | ~85% on input |
| OpenAI (GPT-4o)               | $0.0075 input + $0.0010 output | $0.0039 input + $0.0010 output | ~50% on input |
| Google (Gemini 1.5 Pro)       | $0.0038 input + $0.0005 output | $0.0010 input + $0.0005 output | ~75% on input |

_Prices per request. The "with cache" numbers assume all requests after the first hit the cache._

The savings scale linearly with prefix size. A 10,000-token prefix (common with large tool sets or few-shot examples) saves even more.

## Common Mistakes

### 1. Dynamic content in the prefix

```typescript
// BAD: timestamp changes every request, invalidating the cache
const systemPrompt = `You are a support agent.
Current time: ${new Date().toISOString()}
...2000 more tokens of policies...`;

// GOOD: static prefix, dynamic content in the user message
const systemPrompt = `You are a support agent.
...2000 tokens of policies...`;

const messages = [
  { role: "user", content: `[Current time: ${new Date().toISOString()}]\n${userQuestion}` },
];
```

Any change to the prefix — even a single character — invalidates the cache from that point. Timestamps, session IDs, and request counters must go in the dynamic suffix (user messages), not the system prompt.

### 2. Non-deterministic serialization

```typescript
// BAD: object key order may vary between requests
const tools = Object.fromEntries(
  toolMap.entries(), // Map iteration order can vary
);

// GOOD: explicit, stable ordering
const tools = [
  searchOrdersTool,
  getOrderDetailsTool,
  issueRefundTool,
  // ... always in this exact order
];
```

JSON serialization of tools must produce byte-identical output. Use arrays (ordered) instead of objects (unordered). Sort keys if you must use objects.

### 3. Ignoring minimum thresholds

Each provider has a minimum prefix size for caching:

- **Anthropic**: 1024 tokens (Sonnet/Haiku), 2048 tokens (Opus)
- **OpenAI**: 1024 tokens
- **Google Gemini**: 32,768 tokens (1.5 Pro), 4096 tokens (1.5 Flash)

Below these thresholds, caching doesn't activate. If your system prompt is only 200 tokens, caching won't help — and adding padding to hit the threshold wastes more than it saves.

### 4. Cache TTL assumptions

Anthropic's cache TTL is 5 minutes, refreshed on each hit. OpenAI's is 5-10 minutes. If your agent handles bursty traffic (many requests, then silence), the cache may expire between bursts. For Gemini, you control the TTL explicitly but pay storage costs.

## When to Use Prompt Caching

**Use it when:**

- System prompt exceeds 1024 tokens (most agents with detailed instructions)
- You have many tool definitions (each tool adds ~100-150 tokens)
- Requests come frequently enough to keep the cache warm (< 5 min gaps)
- You're paying per-token on a cloud provider

**Skip it when:**

- System prompt is short (< 500 tokens)
- Each request has a mostly-unique prompt (e.g., RAG with different retrieved docs)
- You're running locally with Ollama (KV-cache is automatic, no cost savings to capture)
- Request volume is too low to keep the cache warm

## Key Takeaways

1. **Caching targets the prefix.** System prompt and tool definitions must come first and be byte-identical across requests. Any dynamic content goes in the suffix (user messages).

2. **The KV-cache is the mechanism.** Transformers compute identical K/V vectors for identical token prefixes. Caching stores those vectors so they don't need recomputation. This is true at every level — Ollama's llama.cpp, vLLM's PagedAttention, and every cloud provider.

3. **Providers differ on control vs. convenience.** Anthropic gives explicit `cache_control` breakpoints. OpenAI caches automatically. Google uses managed cache objects with configurable TTL. The underlying mechanism is the same.

4. **Savings scale with prefix size.** A 3000-token prefix saves meaningful money at scale. A 10,000-token prefix (large tool sets, few-shot examples, conversation history) saves substantially more.

5. **The biggest risk is accidental invalidation.** Timestamps in system prompts, non-deterministic JSON serialization, and unnecessary prompt mutations all silently break caching. Monitor `cache_read_input_tokens` (Anthropic) or `cached_tokens` (OpenAI) to verify it's working.

## Sources & Further Reading

- [Anthropic Prompt Caching](https://www.anthropic.com/news/prompt-caching) — announcement describing `cache_control`, TTL tiers, and pricing (reads at 0.1x cost)
- [Anthropic Prompt Caching API docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) — implementation reference
- [OpenAI Prompt Caching](https://platform.openai.com/docs/guides/prompt-caching) — automatic caching for prompts >= 1024 tokens
- [Google Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching) — configurable TTL, 90% discount on cache hits
- [Efficient Memory Management for LLM Serving with PagedAttention](https://arxiv.org/abs/2309.06180) — Kwon et al. (UC Berkeley), SOSP 2023 — foundational paper on KV-cache sharing that underlies all prompt caching

---

[Agent Patterns — TypeScript](../../README.md) · [Next: Evaluation with Mocked Tools →](../evaluation-patterns/README.md)
