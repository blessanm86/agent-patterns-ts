# The Hidden Second LLM Call — Post-Conversation Metadata for Agent UX

[Agent Patterns — TypeScript](../../README.md)

---

Who names the thread? Who suggests what to ask next? Who decides the conversation is about billing and not a prompt injection attempt?

If you use ChatGPT, you've seen it: the conversation title appears a few seconds after the first response. If you use Open WebUI, follow-up suggestions pop up as clickable chips below the answer. These don't come from the main response. They come from a **second, hidden LLM call** that fires after the primary agent finishes — a post-processing step the user never sees.

This pattern is everywhere in production chat UIs but rarely discussed in agent tutorials. This post unpacks the pattern, shows a working implementation, and explains the tradeoffs.

## The Two-Phase Flow

```
User message
     │
     ▼
┌─────────────────────────────┐
│  Phase 1: ReAct Agent Loop  │
│  (tool calls, reasoning)    │
│  ───────────────────────    │
│  LLM call 1..N             │
└──────────────┬──────────────┘
               │
               ▼
         Agent response
         (shown to user)
               │
               ▼
┌─────────────────────────────┐
│  Phase 2: Metadata Call     │
│  (secondary LLM call)      │
│  ───────────────────────    │
│  Filtered messages →        │
│  Constrained decoding →     │
│  Typed metadata             │
└──────────────┬──────────────┘
               │
               ▼
   ┌───────────────────────┐
   │  threadName            │
   │  category              │
   │  securityFlag          │
   │  suggestions[]         │
   └───────────────────────┘
```

Phase 1 is the standard ReAct loop. Phase 2 is the hidden second call — a single structured-output request that produces all metadata fields at once.

## Why Separate? Why Not Inline?

You could ask the main model to include metadata in its response. Three reasons not to:

**1. Separation of concerns.** The main model's job is to be a helpful support agent. Asking it to also name the thread, classify the request, and detect security issues muddies the prompt and dilutes response quality. Anthropic's "Building Effective Agents" guide explicitly recommends using cheaper models (Haiku) for secondary classification tasks, saving the capable model for reasoning.

**2. Message filtering.** The secondary call doesn't need tool messages or tool-call-only assistant messages. These are noise — raw JSON from account lookups and subscription checks wastes tokens and confuses the classifier. Stripping them before the metadata call produces better results with fewer tokens.

**3. Independent evolution.** The metadata schema can change without touching the main agent prompt. You can add new categories, adjust suggestion count, or swap the metadata model — all without risking regression in the primary response.

## Message Filtering

Before the secondary call, we strip messages that would confuse the metadata model:

```
Before filtering (8 messages):
  user: "Look up Acme Corp"
  assistant: [tool_calls: lookup_account]     ← tool-call-only, no text
  tool: {"found": true, "account": {...}}      ← tool result JSON
  assistant: "I found the Acme Corp account."
  user: "What plan are they on?"
  assistant: [tool_calls: check_subscription]  ← tool-call-only, no text
  tool: {"found": true, "subscription": {...}} ← tool result JSON
  assistant: "They are on the Business plan."

After filtering (4 messages):
  user: "Look up Acme Corp"
  assistant: "I found the Acme Corp account."
  user: "What plan are they on?"
  assistant: "They are on the Business plan."
```

The filtering logic is simple: drop all `tool` messages, drop `assistant` messages that have `tool_calls` but no text content. What remains is the actual conversation — exactly what a human would read.

```typescript
export function filterForMetadata(messages: Message[]): Message[] {
  return messages.filter((m) => {
    if (m.role === "tool") return false;
    if (m.role === "assistant") {
      const hasToolCalls = m.tool_calls && m.tool_calls.length > 0;
      const hasContent = m.content && m.content.trim().length > 0;
      if (hasToolCalls && !hasContent) return false;
    }
    return true;
  });
}
```

## Structured Output with Constrained Decoding

The metadata schema is defined once in Zod and drives both the constrained decoding constraint and runtime validation:

```typescript
export const ConversationMetadataSchema = z.object({
  threadName: z.string().min(1).max(60),
  suggestions: z
    .array(
      z.object({
        label: z.string().min(1), // "Check billing details"
        prompt: z.string().min(1), // "Can you show me the invoice for this month?"
      }),
    )
    .min(1)
    .max(3),
  category: z.enum(["billing", "technical", "feature-request", "account", "general"]),
  securityFlag: z.enum(["none", "pii-detected", "prompt-injection", "suspicious"]),
});

export const METADATA_JSON_SCHEMA = z.toJSONSchema(ConversationMetadataSchema);
```

The JSON Schema goes directly into Ollama's `format` parameter. Constrained decoding compiles the schema into a grammar and enforces it at the token level — the model physically cannot produce output that violates the schema. This is the same pattern from [Structured Output](../structured-output/README.md), applied to a different use case.

We still run `safeParse()` as belt-and-suspenders validation:

```typescript
const response = await ollama.chat({
  model: MODEL,
  system: METADATA_SYSTEM_PROMPT,
  messages: filtered,
  format: METADATA_JSON_SCHEMA, // constrained decoding
});

const parsed = JSON.parse(response.message.content);
const result = ConversationMetadataSchema.safeParse(parsed);
```

## The Four Metadata Fields

### Thread Name

A short title (2-8 words) that summarizes the conversation — like ChatGPT's auto-generated titles or Open WebUI's thread labels. Research from Open WebUI and Vercel AI SDK shows the first user message and first assistant response contain 90%+ of the signal needed for a good title.

### Category

Request classification into one of: `billing`, `technical`, `feature-request`, `account`, `general`. This drives routing, analytics, and escalation logic. Academic work on dialog act classification shows that zero-shot classification with structured schemas reliably matches fine-tuned models.

### Security Flag

Post-hoc safety classification: `none`, `pii-detected`, `prompt-injection`, `suspicious`. Using an LLM-as-a-Judge for safety (rather than heuristic rules) adds no latency to the user's experience since it runs after the response. Production systems like Azure Content Safety and Meta's Llama Guard use similar taxonomies. Our demo keeps it simple with a single flag field.

### Follow-Up Suggestions

1-3 actionable suggestions framed as prompts (not topics). Each has a `label` (short, for a button) and a `prompt` (the full text that would be sent). Open WebUI renders these as clickable chips; ChatGPT shows them as gray bubble prompts. The key insight from practitioners: diversity matters more than cleverness — suggest actions the user wouldn't think of, not rephrases of what they already asked.

## The Agent Implementation

The agent is a standard ReAct loop (customer support for a fictional SaaS platform, "CloudStack") with one addition: after the loop completes, if the mode is `with-metadata`, fire the secondary call.

```typescript
// Standard ReAct loop
while (true) {
  llmCalls++;
  const response = await ollama.chat({ model: MODEL, system: SYSTEM_PROMPT, messages, tools });
  const assistantMessage = response.message as Message;
  messages.push(assistantMessage);

  if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) break;

  for (const toolCall of assistantMessage.tool_calls) {
    // ... execute tools, push results ...
  }
}

// Post-conversation metadata (the hidden second call)
if (mode === "with-metadata") {
  metadataResult = await generateMetadata(messages);
  llmCalls++;
}
```

## Running the Demo

```bash
# With metadata (default) — shows thread name, category, suggestions after each response
pnpm dev:post-conversation-metadata

# Without metadata — baseline for comparison, no secondary call
pnpm dev:post-conversation-metadata:no-metadata
```

### With Metadata

```
Support: I found the Acme Corp account (ACC-1001). They're on the Business
plan at $299/month with 47 users in the us-east-1 region.

  📊 Stats: 3 LLM calls, 1 tool calls [with-metadata mode]
  ⏱️  Metadata latency: 2150ms

  🏷️  Thread: Acme Corp Account Lookup
  📂 Category: account
  ✅ Security: none
  💡 Suggestions:
     1. Check subscription details
     2. View known issues
     3. Search documentation
```

### Without Metadata

```
Support: I found the Acme Corp account (ACC-1001). They're on the Business
plan at $299/month with 47 users in the us-east-1 region.

  📊 Stats: 2 LLM calls, 1 tool calls [no-metadata mode]
```

The `with-metadata` mode always shows exactly 1 more LLM call than `no-metadata` for the same conversation.

## Sequential vs Parallel: A Practical Note

Open WebUI runs 3 parallel background tasks (titles, tags, suggestions) after each response. Our demo runs a single combined call sequentially. Why?

Ollama serves requests sequentially on a single GPU. Firing parallel requests would just queue them — total latency stays the same. Sequential makes the two-phase nature visible and educational. In production with a cloud API (OpenAI, Anthropic), you'd split into parallel calls to a cheap model tier:

| Approach                    | When to use                                                                |
| --------------------------- | -------------------------------------------------------------------------- |
| **Single combined call**    | Local inference, simple schemas, demos                                     |
| **Parallel separate calls** | Cloud APIs, cheap model tiers, when you need independent failure isolation |

## Real-World Patterns

| System                     | Implementation                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------- |
| **ChatGPT**                | Auto-titles conversations after first exchange; suggests follow-ups as gray bubbles |
| **Open WebUI**             | 3-task pattern: titles + tags + suggestions; configurable secondary model; UI chips |
| **Vercel AI SDK**          | `generateTitleFromUserMessage()` helper; fire-and-forget with GPT-4o-mini           |
| **LibreChat**              | Dedicated `titleModel` config; async execution after first response                 |
| **Nvidia NeMo Guardrails** | Output rails as post-response pipeline; `parallel: true` for concurrent execution   |

## Key Takeaways

1. **The second call is invisible but critical.** Thread naming, suggestions, and classification make agent UIs feel polished. Users never see the mechanism — they just see a better experience.

2. **Filter before classifying.** Tool messages are noise for metadata generation. Stripping them improves classification accuracy and reduces token cost.

3. **Constrained decoding makes structured metadata reliable.** A Zod schema compiled into a grammar ensures the metadata always parses. Belt-and-suspenders `safeParse()` catches edge cases.

4. **Use the cheapest model that works.** OpenAI's GPT-4o-mini, Anthropic's Haiku, Gemini Flash — all providers offer cheap tiers designed exactly for this secondary classification role. DeepSeek's prefix caching can make combined prompts even cheaper.

5. **Suggestions should be actionable prompts, not topics.** "Check billing details" with a full prompt behind it is more useful than "billing" as a tag. Frame suggestions as things the user can click and send.

## Sources & Further Reading

- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) — Anthropic, 2024 — parallelization pattern and model tier recommendations
- [Open WebUI](https://github.com/open-webui/open-webui) — reference implementation of 3-task post-conversation metadata
- [Vercel AI SDK](https://sdk.vercel.ai/docs) — `generateTitleFromUserMessage()` fire-and-forget pattern
- [Llama Guard](https://ai.meta.com/research/publications/llama-guard-llm-based-input-output-safeguard-for-human-ai-conversations/) — Meta AI, 2023 — purpose-built safety classifier
- [NeMo Guardrails](https://docs.nvidia.com/nemo/guardrails/) — Nvidia, output rails for post-response processing
- [Azure Content Safety API](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/) — structured safety schema reference
- [Efficient Guided Generation for Large Language Models](https://arxiv.org/abs/2307.09702) — Willard & Louf, 2023 — constrained decoding foundation
- [Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) — Zheng et al., 2023 — post-hoc LLM classification validation
