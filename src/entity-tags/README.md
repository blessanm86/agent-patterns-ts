# Making AI Output Clickable — Structured Entity Tags in LLM Responses

[Agent Patterns — TypeScript](../../README.md) · Builds on [Query Builder Pattern](../query-builder/README.md)

---

An LLM says _"Alice's order shipped yesterday."_ Useful — but you can't click on Alice or the order. You can't hover for details. You can't deep-link to a dashboard.

Now imagine the LLM says the same thing, but wraps the entities:

```xml
<User id="USR-1001" name="Alice Johnson" />'s order
<Order id="ORD-5001" status="shipped" total="105.97" /> shipped yesterday.
```

Same readable text. But now the UI can parse those tags and render them as interactive badges, clickable chips, or hover cards — without a second LLM call.

This is the **structured entity tags** pattern: instruct the LLM to annotate its own prose with machine-parseable entity references, then post-process the output for rich rendering.

## Why Inline Tags Beat Separate JSON

The obvious alternative is asking the LLM to return structured data alongside its text — a JSON array of referenced entities, or a separate "entities" field. But research shows inline annotation consistently outperforms extraction-to-JSON:

| Approach                | Strengths                                                             | Weaknesses                                                           |
| ----------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Inline XML tags**     | LLM sees entity in context, high accuracy (90+ F1), streams naturally | Needs parser, tags can be malformed                                  |
| **Separate JSON block** | Clean separation, easy to parse                                       | LLM loses positional context, lower accuracy (75-88 F1)              |
| **Offset-based JSON**   | Precise character positions                                           | LLMs _cannot reliably count characters_ — 14.5 F1 on nested entities |

A [2025 study](https://arxiv.org/html/2601.17898) measuring five NER output formats found that inline formats (XML tags and bracketed annotations) outperform JSON-based extraction by **3–15 F1 points**. The reason: LLMs process text sequentially, so placing the annotation right next to the entity it describes gives the model the best chance of getting it right.

## The Tag Format

We use self-closing XML tags with typed attributes:

```xml
<User id="USR-1001" name="Alice Johnson" />
<Product id="PROD-2001" name="Wireless Headphones" price="79.99" />
<Order id="ORD-5001" status="shipped" total="105.97" />
<Category id="CAT-301" name="Electronics" />
```

Why this format?

- **Typed** — the tag name (`User`, `Product`) tells the parser what kind of entity it is
- **Self-identifying** — `id` and `name` are always present, extra attributes vary by type
- **Self-closing** — no need to repeat content inside the tag, reducing token waste
- **Familiar** — LLMs are trained on billions of HTML/XML tokens, making tag syntax natural to produce

The parser also handles wrapping form as a fallback: `<User id="USR-1001">Alice Johnson</User>`. Some models prefer this style — handling both makes the system robust.

## Architecture

```
User prompt
    │
    ▼
┌──────────────┐
│  ReAct Loop  │──── tool calls ────▶ lookup_customer, search_products,
│  (agent.ts)  │◀─── results ──────  get_order, list_categories
└──────┬───────┘
       │ final response (with XML tags)
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  parser.ts   │────▶│ renderer.ts  │────▶│  display.ts  │
│  extract     │     │ ANSI badges  │     │ stats panel  │
│  entities    │     │ [👤 Alice #1001]│  │ hit rate     │
└──────────────┘     └──────────────┘     └──────────────┘
```

The key insight: the **raw history** (with XML tags) feeds back to the LLM for continuity, while the **rendered output** (with ANSI badges) goes to the terminal. The LLM never sees its own ANSI output.

## Teaching the LLM the Tag Format

The system prompt does the heavy lifting. Here's the instruction block:

```
## Entity Tag Format

When you reference entities in your response, wrap them in XML-like tags
so the UI can render them as interactive elements. Use the exact IDs
and names from tool results.

<User id="USR-1001" name="Alice Johnson" />
<Product id="PROD-2001" name="Wireless Headphones" price="79.99" />
<Order id="ORD-5001" status="shipped" total="105.97" />
<Category id="CAT-301" name="Electronics" />

Rules:
- Use self-closing tag syntax: <Type attr="val" />
- Always include the id and name attributes
- Use the exact IDs from tool results
- Place tags naturally within your prose
```

Showing one complete example paragraph is critical — the model learns the pattern from demonstration far more reliably than from abstract rules.

## The Parser

The parser is deliberately conservative. It only matches the four known entity type names — no arbitrary XML parsing:

```typescript
const ENTITY_TYPES = ["User", "Product", "Order", "Category"];
const TYPE_PATTERN = ENTITY_TYPES.join("|");

// Self-closing: <Type attr="val" />
const SELF_CLOSING_RE = new RegExp(`<(${TYPE_PATTERN})\\s+([^>]*?)\\s*/>`, "g");

// Wrapping: <Type attr="val">content</Type>
const WRAPPING_RE = new RegExp(`<(${TYPE_PATTERN})\\s+([^>]*?)>([^<]*?)</(${TYPE_PATTERN})>`, "g");
```

This means stray HTML, markdown code blocks, and other XML-like content won't trigger false matches. The parser is also stateless — each call starts fresh, no accumulated state to corrupt.

The `stripEntityTags()` function provides graceful degradation: remove all tags, leaving just the human-readable names. This is useful for logging, accessibility, and plain-text contexts.

## The Renderer

Replacement happens **end-to-start** to preserve character indices:

```typescript
export function renderEntityTags(text: string): string {
  const entities = parseEntityTags(text);

  let result = text;
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    const style = ENTITY_STYLE[entity.type];
    const badge = `${style.color}[${style.emoji} ${entity.name} #${entity.id}]${RESET}`;
    result = result.slice(0, entity.start) + badge + result.slice(entity.end);
  }
  return result;
}
```

Each entity type gets a distinct color and emoji:

| Type     | Emoji | Color   |
| -------- | ----- | ------- |
| User     | 👤    | Cyan    |
| Product  | 📦    | Green   |
| Order    | 🧾    | Yellow  |
| Category | 🏷️    | Magenta |

## Measuring Tag Quality: Hit Rate

The stats panel shows a **tag hit rate**: what percentage of entity IDs that appeared in tool results got proper XML tags in the LLM's response. This is the key quality metric for the pattern.

If the LLM calls `lookup_customer` and gets back `USR-1001`, `ORD-5001`, and `ORD-5002`, and its response tags `USR-1001` and `ORD-5001` but mentions `ORD-5002` without a tag, the hit rate is 67%.

This metric directly measures how well the system prompt instructions are working and where the model is dropping tags.

## Two Modes

Run the demo in two modes to compare:

```bash
pnpm dev:entity-tags        # Tagged mode — XML tags rendered as ANSI badges
pnpm dev:entity-tags:plain  # Plain mode — same agent, no tag instructions
```

Try the same prompts in both modes:

- _"Look up Alice Johnson"_
- _"What's in order ORD-5001?"_
- _"Show me electronics products"_

Tagged mode adds the entity tag instructions to the system prompt. Plain mode uses the same base personality and tools but no tag format spec — a direct comparison of what the instructions add.

## When to Use This Pattern

**Good fit:**

- Chat UIs where entities should be clickable (link to detail pages, open sidebars)
- Support agents referencing customers, orders, tickets
- Code assistants referencing files, functions, classes
- Knowledge bases referencing documents, sections, definitions

**Poor fit:**

- Pure API responses (use structured JSON output instead)
- Short factual answers with no entity references
- Streaming scenarios where you need entities _before_ the full response (tags may split across chunks)

## In the Wild: Coding Agent Harnesses

The structured entity tags pattern — teaching an LLM to embed machine-parseable markers in its output so downstream code can extract meaning — is the same fundamental technique that production coding agents use in both directions. Harnesses structure their _inputs_ to the model with tags (so the LLM can parse context reliably) and structure the model's _outputs_ with tags (so the harness can parse actions reliably). The difference is scope: this demo tags domain entities like users and orders, while harnesses tag tool invocations, file edits, and context sections.

**Claude Code** is the heaviest user of XML tags on the input side. Its system prompt is not a single string but [110+ dynamically assembled fragments](https://github.com/Piebald-AI/claude-code-system-prompts), many wrapped in purpose-built tags. [`<system-reminder>`](https://rastrigin.systems/blog/claude-code-part-2-system-prompt/) blocks inject conditional guidance mid-conversation — todo list nudges, CLAUDE.md overrides, tool-usage reminders — without invalidating the prompt cache. `<env>` tags deliver a snapshot of the working directory, git status, platform, and current branch. `<good-example>` and `<bad-example>` tags codify heuristics by contrasting preferred versus suboptimal approaches. `<command-message>` and `<skills_instructions>` tags manage skill discovery and activation. This is the same "show, don't just tell" principle from our entity tag system prompt — except Claude Code applies it to _behavioral instructions_ rather than entity formatting.

**Cline** takes the pattern in the opposite direction: XML tags structure the model's _output_ rather than its input. Instead of using the provider's native tool-calling API, Cline instructs the LLM to emit [XML-tagged tool invocations](https://docs.cline.bot/exploring-clines-tools/cline-tools-guide) directly in its response text — `<read_file><path>src/main.ts</path></read_file>`, `<execute_command><command>npm test</command></execute_command>`, `<replace_in_file><path>...</path><old_text>...</old_text><new_text>...</new_text></replace_in_file>`. The harness parses these tags with the same conservative regex approach our entity parser uses: match only known tag names, ignore everything else. This makes Cline's tool system work with any model that can produce XML — it doesn't require native function-calling support, which is exactly the kind of graceful degradation that makes inline tags robust.

**Codex CLI** uses a variation of structured markers purpose-built for file editing. Rather than XML, it defines a [custom patch format](https://pypi.org/project/codex-apply-patch/) delimited by `*** Begin Patch` / `*** End Patch` markers, with operations like `*** Update File: main.py` and `*** Add File: hello.txt` inside. This format was co-designed with GPT-4.1 — the model was trained to produce it natively, much like how Claude was trained on XML. The tradeoff mirrors the one in our demo: Codex chose a format that's easy for the model to generate _and_ easy for a parser to extract, even if it's not standard XML. **Aider** takes this diversity further with a [zoo of 7+ edit formats](https://aider.chat/docs/more/edit-formats.html) — whole file, diff, search/replace, editor-diff — each tuned to what different model families produce most reliably.

The throughline across all these harnesses is the core insight behind structured entity tags: LLMs are remarkably good at producing inline structured markup when you show them the format, and a conservative parser on the other side can extract it reliably. Whether the tags represent `<User id="USR-1001" />` entities in a chat response or `<read_file><path>...</path></read_file>` tool calls in an agent loop, the pattern is the same.

## Key Takeaways

1. **Inline XML tags outperform separate JSON extraction** for entity annotation — the LLM gets positional context
2. **Show, don't just tell** — one example paragraph in the system prompt teaches the format better than pages of rules
3. **Parse conservatively** — only match known entity types, not arbitrary XML
4. **Maintain two histories** — raw (for LLM) and rendered (for display) keep the system clean
5. **Measure tag hit rate** — the percentage of tool-result IDs that got tags is your quality signal
6. **Degrade gracefully** — `stripEntityTags()` means the output is always useful, even if rendering fails

## Sources & Further Reading

- [Use XML tags to structure your prompts](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags) — Anthropic — primary source; Claude is trained to treat XML tags as structural mechanisms
- [Anthropic Structured Outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-output) — JSON-schema and XML-delimited structured output patterns
- [Evaluating NER Output Formats for LLMs](https://arxiv.org/html/2601.17898) — Jan 2025 — benchmarks 5 NER output formats; inline XML achieves 90+ F1 vs 73–88 for JSON-based approaches
- [Grammar-Constrained Interaction for Structured Entity Output](https://arxiv.org/abs/2509.08182) — Sep 2025 — formalizes inline entity annotation as constrained generation
- [GPT-NER: Named Entity Recognition via Large Language Models](https://aclanthology.org/2025.findings-naacl.239/) — NAACL 2025 — uses special token markers for inline NER, competitive with supervised baselines
- [Anthropic Prompt Engineering Tutorial — Formatting Output](https://github.com/anthropics/courses/blob/master/prompt_engineering_interactive_tutorial/Anthropic%201P/05_Formatting_Output_and_Speaking_for_Claude.ipynb) — code examples of stop-sequence + XML-tag technique
- [Shape of AI — Citations Patterns](https://www.shapeof.ai/patterns/citations) — documents inline highlights, multi-source references, and chip/pill rendering in production AI UIs
- [slack-message-parser](https://github.com/pocka/slack-message-parser) — real-world example of parsing angle-bracket entity encoding into an AST for chip rendering
