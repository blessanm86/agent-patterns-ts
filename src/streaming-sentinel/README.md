# One Generation, Two Outputs — Piggybacking Structured Metadata on Streaming Prose

[Agent Patterns — TypeScript](../../README.md)

> Builds on: [Streaming Responses (SSE)](../streaming/README.md) and [Post-Conversation Metadata](../post-conversation-metadata/README.md)

---

When an agent finishes answering a user's question, the UI often needs _more than just the answer_ — a conversation title, follow-up suggestions, a category label, maybe a security flag. The [post-conversation-metadata](../post-conversation-metadata/README.md) concept showed one way to get this: fire a second LLM call after the agent responds, feeding it the conversation and asking for structured metadata.

That works, but it doubles your inference cost and adds visible latency. The user has already waited for the response to stream — now they wait _again_ for metadata to appear.

What if the model could produce both the prose and the metadata in a single pass?

## The Sentinel Approach

The idea is simple: tell the model to append a structured JSON block at the end of its response, wrapped in sentinel tags. A stream processor watches the token stream and intercepts these tags before they reach the user.

```
User: "Can you look up the account for Acme Corp?"
                        ↓
              Streaming LLM Response
                        ↓
  "Acme Corp (ACC-1001) is on the Business plan at $299/month,
   with 47 users in us-east-1..."

   <metadata>{"threadName":"Acme Corp Account Lookup",
   "suggestions":[...],"category":"account",
   "securityFlag":"none"}</metadata>
                        ↓
            Sentinel Processor (state machine)
           ┌────────────┴────────────┐
     Prose tokens              Metadata block
     → emit to user            → parse JSON
     (streams live)            → emit MetadataEvent
                               → update UI panel
```

The user sees prose streaming in real-time. They never see the sentinel tags or the JSON. The metadata panel animates in after the prose completes — powered by the same generation that produced the answer.

## How the State Machine Works

The sentinel processor is a three-state machine that intercepts `TextEvent`s in the SSE stream:

```
PROSE  ──(detect "<metadata>")──>  BUFFERING  ──(detect "</metadata>")──>  DONE
```

**PROSE state**: Forward tokens to the user immediately. Keep a trailing buffer of the last 9 characters (one less than `"<metadata>".length`) to catch partial tag matches at chunk boundaries.

**BUFFERING state**: Accumulate tokens silently. The user sees prose stop — the model is generating the metadata JSON, but none of it reaches the chat.

**DONE state**: Parse the buffered JSON, validate with Zod, emit a `MetadataEvent`. If there's text after `</metadata>`, forward it as prose.

Here's the core implementation from `sentinel.ts`:

```typescript
function processText(content: string): void {
  textAccumulator += content;

  if (state === "prose") {
    const tagIndex = textAccumulator.indexOf(OPEN_TAG);
    if (tagIndex !== -1) {
      // Emit prose before the tag, start buffering
      const proseBeforeTag = textAccumulator.substring(emittedUpTo, tagIndex);
      if (proseBeforeTag) innerEmit({ type: "text", content: proseBeforeTag });
      state = "buffering";
    } else {
      // Emit text, but keep trailing characters as partial-tag buffer
      const safeEnd = textAccumulator.length - (OPEN_TAG.length - 1);
      if (safeEnd > emittedUpTo) {
        innerEmit({ type: "text", content: textAccumulator.substring(emittedUpTo, safeEnd) });
        emittedUpTo = safeEnd;
      }
    }
  } else if (state === "buffering") {
    metadataBuffer += content;
    // Check for closing tag
  }
}
```

## The Hard Part: Chunk Boundaries

The model doesn't emit one token at a time to your code — tokens arrive in variable-sized chunks. A sentinel tag like `<metadata>` can easily be split across two chunks:

```
Chunk 1: "...your account details.\n\n<meta"
Chunk 2: "data>{\"threadName\":\"Account Lookup\"..."
```

If you only check each chunk in isolation, you'll miss the tag and forward `<meta` to the user as visible text.

The solution is a **trailing buffer**. Instead of forwarding _all_ text in the PROSE state, we hold back the last `N-1` characters (where `N` is the opening tag length). On each new chunk, we concatenate and re-check for the full tag. If no tag appears, the held-back text gets forwarded with the next chunk.

This adds at most 9 characters of display latency — invisible at streaming speeds.

## Fallback: When the Model Doesn't Cooperate

Not every model will reliably append sentinel tags, even with explicit instructions. The processor handles this gracefully:

- **No sentinel detected**: When the stream ends in PROSE state, `flush()` forwards any held-back text. The user sees the full response with no metadata panel — identical to having no metadata at all.
- **Truncated metadata**: If the stream ends mid-BUFFERING (model generated `<metadata>` but not `</metadata>`), the raw content is flushed as visible text. The user sees the partial JSON, which isn't ideal but is better than silently swallowing content.
- **Malformed JSON**: If the JSON between tags fails Zod validation, no `MetadataEvent` fires. The UI shows "No metadata extracted."

This graceful degradation means the sentinel approach is safe to use as an enhancement — the agent works fine with or without metadata.

## Head-to-Head: Sentinel vs. Separate Call

This demo lets you toggle between modes to compare directly:

| Metric                | Sentinel Mode                           | Separate Call Mode                            |
| --------------------- | --------------------------------------- | --------------------------------------------- |
| LLM calls             | **1**                                   | 2                                             |
| Metadata latency      | **~0ms** (inline)                       | 2-8 seconds (full generation)                 |
| Total inference cost  | **1x**                                  | ~1.5-2x                                       |
| User-visible gap      | None — metadata appears with prose      | Visible wait after prose completes            |
| Reliability           | Depends on model following instructions | High — constrained decoding guarantees schema |
| Works with all models | Models may ignore sentinel instructions | Any model with JSON mode support              |

**When to use sentinel mode:**

- You're using a model that reliably follows formatting instructions (most 7B+ models)
- Metadata latency matters (real-time UIs, chatbots)
- You want to minimize inference cost
- Metadata is "nice to have" — missing it is acceptable

**When to use separate call mode:**

- You need guaranteed metadata on every response
- You're using models that struggle with appended structure
- Metadata quality is critical (routing decisions, compliance logging)
- You can tolerate the extra latency and cost

## System Prompt Design

The sentinel approach lives or dies by the system prompt. The key instruction:

```
After your complete response, you MUST append a metadata block. This block MUST:
- Appear at the very end of your response, after ALL prose content
- Be wrapped in <metadata>...</metadata> tags
- Contain valid JSON matching this exact schema: { "threadName": ..., ... }
```

Three things make this work:

1. **Position**: "at the very end" prevents the model from placing metadata mid-response
2. **Concrete example**: An inline example of the exact format dramatically improves compliance
3. **Schema description**: The model needs to know the fields, types, and constraints

The tag name `<metadata>` was chosen for low false-positive risk — it's unlikely to appear in CloudStack support prose. For domains where it might (e.g., HTML documentation), use something more unique like `<__agent_meta__>`.

## In the Wild: Coding Agent Harnesses

Sentinel-based extraction from streaming LLM output is one of the oldest patterns in the coding agent ecosystem. Harnesses range from pure sentinel parsing to fully structured API protocols.

**Aider** is the canonical example. Its edit format uses git-merge-style sentinels (`<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`) to delimit code changes within the model's text output. The model generates prose explanation interspersed with these edit blocks, and Aider's parser extracts both. The format deliberately mimics git merge conflict markers, leveraging the model's training data familiarity with this pattern. When extraction fails, Aider falls back through progressive fuzzy matching: exact match, whitespace-insensitive, then edit-distance scoring.

**Cline** takes sentinel extraction further with full XML tag parsing. Tool calls are expressed as XML elements (`<write_to_file><path>...</path><content>...</content></write_to_file>`) embedded in the model's text response. A streaming parser re-parses the entire accumulated buffer on each new chunk, marking incomplete blocks as `partial: true`. This re-parse approach is simpler than an incremental state machine but does redundant work — a tradeoff Cline accepts for implementation simplicity.

**Claude Code** takes the opposite approach: no sentinel extraction at all. Metadata like session titles and follow-up suggestions are generated by separate lightweight sub-agents, each with their own optimized system prompt. The main agent stream uses Anthropic's native content block protocol for tool calls (`tool_use` events), so no text parsing is needed. This pattern trades the extra API calls for guaranteed structure and clean separation of concerns.

**Roo Code** (a Cline fork) tells the directional story. It originally used Cline's XML sentinel parsing but **migrated entirely to native tool calling**, removing XML support because it "lacked type safety" and "required error-prone string parsing." This mirrors the broader industry trend: sentinel extraction is increasingly a compatibility layer for models that don't support native function calling, not the primary architecture.

**OpenAI Codex CLI** uses a custom patch format (`*** Begin Patch` / `*** End Patch`) with sentinel delimiters designed for clean extraction. However, the patch content is passed as a structured tool argument — the sentinels structure the _content of_ a tool call rather than being extracted from free text.

## Academic Validation

The sentinel pattern has direct academic backing:

**CRANE** (ICML 2025) uses start/end delimiters (`<<` / `>>`) to dynamically switch between constrained and unconstrained generation within a single sequence. Their theoretical analysis proves why this matters: fully constrained decoding reduces the model's computational expressiveness to TC^0 complexity, making certain reasoning tasks unsolvable. The delimiter-switching approach restores full expressiveness while maintaining 100% structural correctness. Token overhead: ~2%.

**XGrammar** (MLSys 2025) proves that grammar enforcement during token generation adds less than 40 microseconds per token — effectively zero compared to 5-50ms LLM inference time. For sentinel detection, which is computationally simpler than full grammar enforcement, the overhead is even less.

**JSONSchemaBench** (2025) found that constrained decoding is actually **50% faster** than unconstrained generation in optimized frameworks, and _improves_ downstream accuracy by 3-4 percentage points through token-healing mechanisms. Structure enforcement can be free or even beneficial.

The research converges on a clear finding: **mixing free-form prose with structured regions outperforms either pure approach.** Free-form preserves reasoning quality; structured regions guarantee parseable output. The sentinel delimiter is the mechanism that separates the two.

## Key Takeaways

1. **One generation, two outputs.** The sentinel approach extracts structured metadata from the same LLM pass that generates the prose response — zero additional inference cost.

2. **The state machine is the core abstraction.** Three states (PROSE → BUFFERING → DONE), a trailing buffer for chunk boundaries, and a JSON parser. That's the entire implementation.

3. **Graceful degradation is non-negotiable.** Models will sometimes ignore sentinel instructions. The processor must flush buffered text and continue without metadata rather than breaking the response.

4. **The tradeoff is reliability vs. cost.** Sentinel mode saves ~50% inference cost but depends on model cooperation. Separate-call mode guarantees metadata but doubles the cost. Choose based on whether metadata is critical or decorative.

5. **The industry is moving away from text-level sentinel parsing** toward structured API protocols (native tool calling, typed content blocks). Sentinel extraction remains valuable as a compatibility layer and for metadata piggybacking where API-level structure isn't available.

## Sources & Further Reading

- [CRANE: Reasoning with Constrained LLM Generation (ICML 2025)](https://arxiv.org/abs/2502.09061) — delimiter-based mode switching, formal proof of expressiveness preservation
- [XGrammar: Flexible and Efficient Structured Generation (MLSys 2025)](https://arxiv.org/abs/2411.15100) — near-zero overhead grammar enforcement
- [JSONSchemaBench: Structured Outputs from LLMs (2025)](https://arxiv.org/abs/2501.10868) — constrained decoding benchmark, 50% speedup finding
- [Grammar-Aligned Decoding (NeurIPS 2024)](https://arxiv.org/abs/2405.21047) — distribution-preserving constraints
- [Thinking Before Constraining (2026)](https://arxiv.org/abs/2601.07525) — trigger token framework for mixed-mode generation
- [Aider Edit Formats](https://aider.chat/docs/more/edit-formats.html) — sentinel-delimited edit blocks in practice
- [Cline Streaming Parser](https://github.com/cline/cline/blob/main/src/core/assistant-message/parse-assistant-message.ts) — XML tag extraction from streaming text
- [Roo Code: Native Tool Use RFC](https://github.com/RooCodeInc/Roo-Code/issues/4047) — migration away from XML sentinel parsing
- [Aha.io: Incremental JSON Parsing for Streaming](https://www.aha.io/engineering/articles/streaming-ai-responses-incomplete-json) — O(n) incremental parsing benchmark
- [Anthropic — Streaming Messages](https://docs.anthropic.com/en/api/messages-streaming) — SSE event format for structured streaming
- [OpenAI Codex: apply_patch format](https://github.com/openai/codex/blob/main/codex-rs/apply-patch/apply_patch_tool_instructions.md) — sentinel-delimited patch protocol
