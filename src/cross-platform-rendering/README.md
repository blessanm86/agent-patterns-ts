# Cross-Platform Response Rendering

Your agent works great in the terminal. Then product asks for a Slack integration. Then a web dashboard. Then markdown exports. Suddenly you're maintaining four string-munging pipelines that drift apart every time someone adds a new entity type.

The fix: **one canonical output format** (markdown with XML entity tags), parsed once, dispatched through a **typed renderer table** that TypeScript enforces at compile time. Add a new entity type and forget a renderer? The build fails before you ship broken output.

This is the "Create Once, Publish Everywhere" (COPE) pattern — the same architecture headless CMSes like Contentful use, applied to agent output.

> **Builds on:** [Structured Entity Tags](../entity-tags/README.md) — read that first to understand the XML tag format and parser.

---

## Architecture

```
                          Agent Response (raw)
                                │
                    "I found <User id="USR-1001"
                     name="Alice Johnson" /> ..."
                                │
                         ┌──────┴──────┐
                         │   Parser    │    parseEntityTags()
                         │  (regex)    │    → ParsedEntity[]
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                   │
    ┌─────────▼──────┐  ┌──────▼──────┐  ┌────────▼────────┐
    │   Terminal      │  │  Markdown   │  │   Slack / HTML  │
    │  entityRenderers│  │ entityRend. │  │  entityRenderers│
    │  Record<E,Fn>   │  │ Record<E,Fn>│  │  Record<E,Fn>   │
    └─────────┬──────┘  └──────┬──────┘  └────────┬────────┘
              │                 │                   │
    [👤 Alice #USR-1001]  [👤 Alice]         <span class=...>
    (ANSI colors)        (entity://link)     *:bust: Alice*
```

The parser runs once. Each renderer is a `Record<EntityType, (entity) => string>` — a dispatch table where TypeScript ensures every entity type has a handler.

---

## The Key Type: `EntityRendererMap`

The entire pattern hinges on one type:

```typescript
// types.ts
export type EntityType = "User" | "Product" | "Order" | "Category";
export type PlatformType = "terminal" | "markdown" | "slack" | "html";

// THE KEY TYPE — forces exhaustive handling per entity type
export type EntityRendererMap = Record<EntityType, (entity: ParsedEntity) => string>;

export interface PlatformRenderer {
  name: string;
  entityRenderers: EntityRendererMap;
  wrapResponse?: (text: string, entities: ParsedEntity[]) => string;
}
```

`Record<EntityType, Handler>` means **every renderer must handle every entity type**. This isn't a suggestion — it's a compile error:

```typescript
// ❌ TypeScript error: Property 'Category' is missing in type...
const broken: EntityRendererMap = {
  User: (e) => `[${e.name}]`,
  Product: (e) => `[${e.name}]`,
  Order: (e) => `[${e.name}]`,
  // forgot Category → won't compile
};
```

The same pattern applies to the renderer registry:

```typescript
// renderers/index.ts
const RENDERERS: Record<PlatformType, PlatformRenderer> = {
  terminal: terminalRenderer,
  markdown: markdownRenderer,
  html: htmlRenderer,
  slack: slackRenderer,
};
```

Add `"discord"` to `PlatformType` and this registry fails to compile until you provide a Discord renderer. Two union types, two `Record` tables — the type system does the bookkeeping.

---

## Walking Through the Renderers

### Terminal — ANSI Colored Badges

The terminal renderer produces colored inline badges with emoji prefixes:

```typescript
// renderers/terminal.ts
const entityRenderers: EntityRendererMap = {
  User: (entity) => {
    const s = ENTITY_STYLE.User; // { emoji: "👤", color: ANSI.cyan }
    const idSuffix = entity.id ? ` #${entity.id}` : "";
    return `${s.color}${ANSI.bold}[${s.emoji} ${entity.name}${idSuffix}]${ANSI.reset}`;
  },
  Product: (entity) => {
    /* green badge with 📦 */
  },
  Order: (entity) => {
    /* yellow badge with 🧾 */
  },
  Category: (entity) => {
    /* magenta badge with 🏷️ */
  },
};
```

**Output:** `[👤 Alice Johnson #USR-1001]` (in cyan bold)

### Markdown — Protocol Links

```typescript
// renderers/markdown.ts
const entityRenderers: EntityRendererMap = {
  User: (entity) => {
    const uri = entity.id ? `entity://user/${entity.id}` : "entity://user";
    return `[👤 ${entity.name}](${uri})`;
  },
  // ... same pattern for Product, Order, Category
};
```

**Output:** `[👤 Alice Johnson](entity://user/USR-1001)`

The `entity://` protocol is a custom URI scheme — a web frontend can intercept these links and open an entity detail panel. Same idea as `vscode://` or `slack://` deep links.

### HTML — Data-Attributed Spans

```typescript
// renderers/html.ts
const entityRenderers: EntityRendererMap = {
  User: (entity) => {
    const name = escapeHtml(entity.name);
    const id = escapeHtml(entity.id);
    return `<span class="entity entity-user" data-type="user" data-id="${id}">${name}</span>`;
  },
  Product: (entity) => {
    // Includes data-price when available
    const price = entity.attributes.price
      ? ` data-price="${escapeHtml(entity.attributes.price)}"`
      : "";
    return `<span class="entity entity-product" data-id="${id}"${price}>${name}</span>`;
  },
  // ...
};
```

**Output:** `<span class="entity entity-user" data-type="user" data-id="USR-1001">Alice Johnson</span>`

A React frontend adds CSS highlighting and click handlers via `data-*` attributes. No runtime parsing needed — the data is already in the DOM.

### Slack — mrkdwn + Block Kit JSON

Slack is the most complex renderer because it has two layers:

1. **Inline rendering** — Slack mrkdwn formatting (bold, emoji shortcodes)
2. **Wrapping** — Block Kit JSON envelope with section and context blocks

```typescript
// renderers/slack.ts
const entityRenderers: EntityRendererMap = {
  User: (entity) => {
    const id = entity.id ? ` (${entity.id})` : "";
    return `*:bust_in_silhouette: ${entity.name}*${id}`;
  },
  // ...
};

function wrapResponse(text: string, entities: ParsedEntity[]): string {
  const blocks = [{ type: "section", text: { type: "mrkdwn", text } }];
  if (entities.length > 0) {
    blocks.push({
      type: "context",
      elements: unique.map((e) => ({
        type: "mrkdwn",
        text: `${SLACK_EMOJI[e.type]} ${e.name} \`${e.id}\``,
      })),
    });
  }
  return JSON.stringify({ blocks }, null, 2);
}
```

**Inline output:** `*:bust_in_silhouette: Alice Johnson* (USR-1001)`

**Wrapped output:**

```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "I found *:bust_in_silhouette: Alice Johnson* (USR-1001)..."
      }
    },
    {
      "type": "context",
      "elements": [{ "type": "mrkdwn", "text": ":bust_in_silhouette: Alice Johnson `USR-1001`" }]
    }
  ]
}
```

The `wrapResponse` hook is optional — only Slack uses it. Terminal, markdown, and HTML just return the inline-rendered text directly.

---

## The Core Function: `renderForPlatform`

All four renderers are invoked through one function:

```typescript
// renderers/index.ts
export function renderForPlatform(
  rawText: string,
  platform: PlatformType,
): { rendered: string; entities: ParsedEntity[] } {
  const entities = parseEntityTags(rawText);
  const renderer = RENDERERS[platform];

  // Replace from end to start so character indices stay valid
  let result = rawText;
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    const renderFn = renderer.entityRenderers[entity.type];
    const replacement = renderFn(entity);
    result = result.slice(0, entity.start) + replacement + result.slice(entity.end);
  }

  // Optional platform-level wrapping
  if (renderer.wrapResponse) {
    result = renderer.wrapResponse(result, entities);
  }

  return { rendered: result, entities };
}
```

The end-to-start replacement is important: entity tags have different lengths than their rendered replacements. Replacing from the end preserves the start indices of earlier entities.

---

## Adding a New Entity Type

This is the key teaching moment. Say you add a `"Coupon"` entity type:

```typescript
export type EntityType = "User" | "Product" | "Order" | "Category" | "Coupon";
```

Immediately, **every renderer** fails to compile:

```
// renderers/terminal.ts
error TS2741: Property 'Coupon' is missing in type
  '{ User: ...; Product: ...; Order: ...; Category: ...; }'
but required in type 'Record<EntityType, (entity: ParsedEntity) => string>'.

// renderers/markdown.ts  — same error
// renderers/html.ts      — same error
// renderers/slack.ts     — same error
```

Four errors, four files, zero runtime surprises. You can't forget a platform.

## Adding a New Platform

Add `"discord"` to `PlatformType`:

```typescript
export type PlatformType = "terminal" | "markdown" | "slack" | "html" | "discord";
```

The registry fails to compile:

```
// renderers/index.ts
error TS2741: Property 'discord' is missing in type
  '{ terminal: ...; markdown: ...; html: ...; slack: ...; }'
```

One error, one file: create `renderers/discord.ts` with a full `EntityRendererMap`, add it to the registry, done.

---

## Why Not unified/remark?

The [unified](https://unifiedjs.com/) ecosystem (remark, rehype, retext) provides a full markdown-to-AST pipeline with visitor-pattern traversal. It's the right choice when your input is standard markdown and you need structural transformations.

Our input isn't standard markdown — it's prose with custom XML entity tags. The tags don't follow markdown syntax, so remark's parser won't recognize them. We'd need a custom plugin to extract them, and at that point we're just wrapping our regex parser in extra abstraction.

The regex parser from [Structured Entity Tags](../entity-tags/README.md) is 40 lines, handles both self-closing and wrapping forms, and returns positioned entities ready for replacement. It's the right tool for this job.

**When to reach for unified:** If your agent output is actual markdown (headings, lists, code blocks) and you need to transform the structure — not just replace inline tags — then unified's AST gives you reliable transformations that regex can't.

---

## In the Wild: Coding Agent Harnesses

Cross-platform rendering is a real, ongoing challenge for every coding agent harness — and their approaches reveal interesting tradeoffs.

**Claude Code** ships as both a terminal CLI and a VS Code extension. The terminal version uses ANSI escape codes for colors, bold text, and markdown rendering. The VS Code version renders in a native webview panel with full HTML/CSS. The same agent response looks fundamentally different across the two surfaces. This dual-rendering challenge has been a source of formatting bugs — misaligned bold text, color issues — that highlight exactly why a structured intermediate format matters.

**Cline** takes the most relevant approach to our pattern. Its agent output uses XML-tagged content (tool calls like `<read_file>`, `<write_to_file>`) that gets parsed and rendered differently depending on the host: VS Code panels render interactive UI elements with approve/reject buttons, while JetBrains and the newer CLI mode render the same tags as terminal-formatted text. One canonical format, multiple renderers — the exact COPE pattern.

**Anthropic's Artifacts** demonstrate the pattern at the product level. When Claude generates code, diagrams, or interactive content, it's tagged as a specific artifact type and rendered in a separate panel. The same artifact JSON renders natively across web, iOS, and Android — each platform has its own renderer for the same structured content.

**Vercel's Chat SDK** is the most architecturally explicit implementation. It provides a `BaseFormatConverter` class with platform-specific adapters (Slack, Teams, Discord, GitHub). JSX card components compile to platform-native formats — Block Kit for Slack, Adaptive Cards for Teams, embeds for Discord. Adding a new platform means implementing one adapter, not touching any bot logic. This is the same dispatch-table architecture we built, but scaled to a production SDK.

The common thread: every harness that ships on multiple surfaces eventually arrives at some form of "structured intermediate → platform-specific renderer." The question is whether that structure is explicit and typed (like our `EntityRendererMap`) or implicit and scattered across `if (platform === 'slack')` branches.

---

## Key Takeaways

1. **`Record<UnionType, Handler>` is your exhaustiveness enforcer.** Two `Record` types — one for entity handlers per platform, one for the platform registry — catch every missing case at compile time.

2. **Parse once, render many.** The regex parser extracts `ParsedEntity[]` once. Each renderer consumes the same array through its typed dispatch table. No re-parsing, no format-specific extraction.

3. **End-to-start replacement preserves indices.** When entity tags and their replacements have different lengths, replacing from the end of the string backward keeps earlier entities' character positions valid.

4. **`wrapResponse` handles platform envelopes.** Most platforms just need inline replacement. Slack needs a JSON wrapper. The optional hook keeps the common case simple while allowing platform-specific post-processing.

5. **Don't reach for AST tooling when regex suffices.** The unified/remark ecosystem is powerful but designed for standard markdown. Custom XML tags embedded in prose are a regex job — 40 lines of parser vs. a dependency tree.

---

## Sources & Further Reading

- [Structured Entity Tags (prerequisite)](../entity-tags/README.md) — the XML tag format and parser this pattern builds on
- [Slack Block Kit documentation](https://docs.slack.dev/block-kit/) — Slack's structured message format
- [Adaptive Cards](https://adaptivecards.io/) — Microsoft's platform-agnostic card schema (Teams, Outlook, Windows)
- [Vercel Chat SDK](https://chat-sdk.dev/) — adapter-based multi-platform bot framework
- [unified ecosystem](https://unifiedjs.com/) — markdown AST pipeline (remark, rehype)
- [`@tryfabric/mack`](https://github.com/tryfabric/mack) — markdown to Slack Block Kit via AST
- [COPE (Create Once, Publish Everywhere)](https://www.programmableweb.com/news/cope-create-once-publish-everywhere/2009/10/13) — the original headless content pattern
- [TypeScript `Record` utility type](https://www.typescriptlang.org/docs/handbook/utility-types.html#recordkeys-type) — how `Record<K, V>` enforces exhaustive key coverage

---

[Agent Patterns — TypeScript](../../README.md)
