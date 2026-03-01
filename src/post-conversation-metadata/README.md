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

## In the Wild: Coding Agent Harnesses

The post-conversation metadata pattern is pervasive in coding agent harnesses, though the "conversation" is often a single edit cycle or task rather than a multi-turn chat. The metadata these harnesses generate after the primary work completes — commit messages, PR descriptions, session summaries, cost reports — follows the same two-phase architecture: finish the real work first, then fire a secondary LLM call (or calls) to produce structured artifacts about what just happened.

**Aider** is the clearest example of a dedicated secondary model for post-conversation metadata. Aider assigns four distinct roles to potentially different models: the main model for code editing, an editor model for applying changes, a "weak model" for commit messages and chat history summarization, and optionally a separate commit model. After every edit cycle, [Aider sends the weak model a copy of the diffs and the chat history](https://aider.chat/docs/git.html) and asks it to produce a commit message following [Conventional Commits](https://www.conventionalcommits.org/) format. A typical session output shows this split clearly: `Models: gpt-4o with diff edit format, weak model gpt-3.5-turbo`. The commit message prompt is customizable via `--commit-prompt`, and auto-commits are enabled by default (`--auto-commits`). This is exactly the pattern from this post — a cheaper model handling a structured metadata task that the main model shouldn't be distracted by.

**Claude Code** generates post-session metadata at multiple levels. During a session, [compaction summaries](https://platform.claude.com/docs/en/build-with-claude/compaction) act as rolling metadata — when the context window approaches ~95% capacity, Claude Code summarizes the conversation history into a structured summary record, effectively producing a "what happened so far" artifact. These summaries persist as [session memory files](https://claudefa.st/blog/guide/mechanics/session-memory) at `~/.claude/projects/<project-hash>/<session-id>/`. Beyond summarization, every assistant turn is annotated with token counts (input, output, cache reads) and estimated cost, aggregated into session totals visible via the [`/cost` command](https://code.claude.com/docs/en/costs). This per-turn cost metadata is a form of post-conversation instrumentation — structured data generated alongside but independently from the primary response.

**GitHub Copilot's coding agent** automates the full post-task artifact pipeline. After completing a coding task, the agent [handles branch creation, commit message writing, PR opening, and PR description writing](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) as a unified post-task phase. Copilot's commit message generation uses a [simple-prompt flow against the Copilot API](https://docs.github.com/en/copilot/responsible-use/copilot-commit-message-generation) — it sends code diffs as a text completion request and receives a suggested title and description. Notably, Copilot uses "the generic large language model and no additional trained models" for this, in contrast to Aider's explicit weak-model separation. The coding agent then requests a review from the developer, creating a human-in-the-loop checkpoint on the generated metadata.

**Devin** takes post-task metadata generation further with template-aware PR descriptions. After completing a task, Devin [searches the repository for PR templates](https://docs.devin.ai/integrations/pr-templates) in a priority order: Devin-specific overrides (`DEVIN_PR_TEMPLATE.md`) first, then standard GitHub templates (`PULL_REQUEST_TEMPLATE.md`), falling back to a built-in default structure with sections for summary, review checklist, and optional Mermaid diagrams. This template discovery is itself a form of metadata schema — the harness adapts its post-conversation output format based on project-level configuration. Devin also runs an [automated review pass](https://cognition.ai/blog/devin-101-automatic-pr-reviews-with-the-devin-api) on every PR it generates, analyzing the diff for logic errors, missing edge cases, and security issues — a secondary LLM call that classifies and annotates the primary work product.

**Amazon Q Developer** extends the pattern to documentation. After code changes, Amazon Q can [review new code and suggest associated updates to README files](https://aws.amazon.com/blogs/aws/new-amazon-q-developer-agent-capabilities-include-generating-documentation-code-reviews-and-unit-tests/), keeping documentation in sync with modifications. When creating PRs through its feature development workflow, the agent generates [detailed PR descriptions documenting all changes, implementation steps, and a security review](https://aws.amazon.com/blogs/devops/quickly-go-from-idea-to-pr-with-codecatalyst-using-amazon-q/). The `/doc` command explicitly triggers post-change documentation generation, and `/review` triggers post-change security and quality analysis — both are structured metadata extraction from the conversation's code artifacts.

The pattern across all these harnesses is consistent: the primary agent loop focuses on code generation and editing, then a separate phase — using either the same model, a cheaper model, or a specialized prompt — extracts structured metadata (commit messages, PR descriptions, session summaries, documentation updates) from the conversation's artifacts. Aider's four-model-role architecture makes this separation most explicit, but every harness implements some version of the two-phase flow described in this post.

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
