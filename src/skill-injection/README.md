# Don't Put Everything in the System Prompt — On-Demand Skill Injection for Agents

[Agent Patterns — TypeScript](../../README.md)

---

You have an agent with 15 tools. Each tool description includes not just what the tool does, but step-by-step instructions for every workflow it might be part of: how to handle complaints, how to process returns, how to fulfill backorders. The descriptions are hundreds of tokens each. Every single LLM call pays for all of it — even when the user just wants to check an order status.

This is the context bloat problem, and research shows it's worse than you think.

## The Problem: Context Length Degrades Performance

The intuition is simple: more instructions in the prompt = better agent behavior. The research says the opposite.

**Academic evidence:**

- Even with perfect retrieval, stuffing context degrades LLM performance by **13.9%–85%** depending on task complexity ([Du & Tian, 2025](https://arxiv.org/abs/2502.08003))
- The "Lost in the Middle" effect: LLMs exhibit a U-shaped performance curve, reliably ignoring information in the middle of long prompts ([Liu et al., 2024](https://arxiv.org/abs/2307.03172))
- Performance starts degrading at just **~3,000 tokens** on reasoning tasks

**Industry measurements:**

- Anthropic's internal benchmarks: reducing tool-definition tokens by 85% (77K → 8.7K) improved Opus 4 accuracy from **49% → 74%** and Opus 4.5 from **79.5% → 88.1%**
- OpenAI's documented limit: ~100 tools with ~20 args each is the boundary before reliability degrades
- Google ADK community pattern: ~94% reduction in tool context consumption with dynamic loading

The pattern that fixes this: **don't embed workflow instructions in tool descriptions. Load them on demand.**

## The Pattern: Progressive Disclosure

```
┌──────────────────────────────────────────────────────────────────────┐
│                     System Prompt (always loaded)                     │
│                                                                      │
│  "You are a customer support agent..."                               │
│                                                                      │
│  Available Skills:                                                   │
│  - investigate_complaint: Investigate a customer complaint            │
│  - process_return: Process a return and refund                       │
│  - fulfill_backorder: Check and fulfill pending orders               │
│  - full_escalation_workflow: End-to-end complaint handling           │
│                                                                      │
│  "Call get_skill before starting a multi-step procedure."            │
│                                                                      │
│  Tools: search_orders, get_order_details, process_refund,            │
│         update_shipping, send_customer_email, check_inventory,       │
│         get_skill                                  ← meta-tool       │
└──────────────────────────────────────────────────────────────────────┘
                           │
                           │ Agent sees complaint → calls get_skill("investigate_complaint")
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Skill Instructions (loaded on demand)                │
│                                                                      │
│  1. Use search_orders to find the order by ID or customer name       │
│  2. Use get_order_details to pull the full order record              │
│  3. For each item, use check_inventory for replacement availability  │
│  4. Summarize findings: status, what went wrong, replacements        │
└──────────────────────────────────────────────────────────────────────┘
                           │
                           │ Agent now follows the steps
                           ▼
                    search_orders → get_order_details → check_inventory → respond
```

The key insight: **the skill catalog is cheap** (~1 line per skill in the system prompt). The **instructions are expensive** (multi-step procedures with tool sequences). Only load instructions when the agent actually needs them.

## Implementation Walkthrough

### The Skill Type

```typescript
interface Skill {
  name: string;
  description: string; // One-line — shown in the catalog
  requiredTools: string[]; // Must all be present for skill to be offered
  instructions: string[]; // Full steps — loaded on demand via get_skill
}
```

Each skill is a named bundle of procedure steps. The `requiredTools` field enables **dynamic filtering** — if a tool is disabled or unavailable, skills that depend on it are automatically removed from the catalog.

### Dynamic Filtering

```typescript
function getAvailableSkills(presentToolNames: string[]): Skill[] {
  const present = new Set(presentToolNames);
  return SKILL_REGISTRY.filter((skill) => skill.requiredTools.every((t) => present.has(t)));
}
```

This matters for multi-tenant systems where different users have different permissions, or for deployments where some tools are feature-flagged.

### The get_skill Meta-Tool

The meta-tool is built dynamically with a `enum` constraint listing only available skills:

```typescript
function buildGetSkillTool(presentToolNames: string[]): ToolDefinition {
  const available = getAvailableSkills(presentToolNames);
  return {
    type: "function",
    function: {
      name: "get_skill",
      description: "Load step-by-step instructions for a multi-tool workflow...",
      parameters: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            enum: available.map((s) => s.name), // ← dynamic
          },
        },
        required: ["skill_name"],
      },
    },
  };
}
```

The `enum` prevents hallucinated skill names — the model can only pick from valid options.

### Two Modes: With and Without Skills

The demo supports both modes so you can compare directly:

| Mode          | Tool descriptions                      | Workflow instructions                | get_skill |
| ------------- | -------------------------------------- | ------------------------------------ | --------- |
| **Skills**    | Concise (what the tool does)           | In skill registry (loaded on demand) | Yes       |
| **No-Skills** | Verbose (what + how + when + workflow) | Embedded in every tool description   | No        |

## Skill Composition

Skills can reference other skills in their instructions:

```typescript
{
  name: "full_escalation_workflow",
  instructions: [
    "First, follow the 'investigate_complaint' skill steps...",
    "If refunding: follow the 'process_return' skill steps...",
    "Use send_customer_email to send a final summary...",
  ],
}
```

This creates a hierarchy: simple skills for individual procedures, composite skills for end-to-end workflows. The agent can load the parent skill and, if needed, load the referenced child skills too.

## With vs Without: What Changes

**Without skills (verbose tool descriptions):**

```
search_orders: Search orders by customer name, order ID, or status.

WORKFLOW INSTRUCTIONS:
- When investigating a complaint: always search for the order first,
  then call get_order_details for the full record, then check_inventory
  for replacement availability.
- When fulfilling backorders: search with status "processing" to find
  pending orders, then check inventory for each, then update_shipping
  for fulfillable ones.
- When handling escalations: search first, then investigate, then decide
  between replacement or refund, and always send_customer_email at the end.
- For return processing: after finding the order, verify it's in "shipped"
  or "delivered" status before processing a refund.
```

Every tool carries instructions for every workflow. Multiply this by 6 tools, and the tool descriptions alone are thousands of characters — sent on every LLM call.

**With skills (concise descriptions + on-demand loading):**

```
search_orders: Search orders by customer name, order ID, or status.
    Returns matching orders with basic info.
```

Clean. The workflow knowledge lives in the skill registry and gets loaded only when needed.

## Why the LLM Selects Skills (Not an Algorithm)

A common question: why not use keyword matching or embeddings to auto-select skills? Three reasons:

1. **Intent is ambiguous.** "ORD-1001 arrived damaged" could trigger `investigate_complaint` or `full_escalation_workflow` — only the conversational context (is this a first contact or a follow-up?) determines the right one.

2. **The catalog is small.** With 4-20 skills, each described in one sentence, an LLM can trivially pick the right one. The cost of showing the catalog is negligible. Retrieval adds complexity for no gain.

3. **The model can compose.** If the situation requires steps from two skills, the model can call `get_skill` twice and combine. A retrieval algorithm would need custom merging logic.

For systems with 100+ skills, hybrid approaches (embedding-based retrieval to shortlist, then LLM selection) make sense. For typical agents, the LLM is the retrieval system.

## Tradeoffs

**Latency:** Skill injection adds one extra round-trip (the `get_skill` call) before the agent can start executing domain tools. For real-time chat, this is ~50% more latency on the first tool call. For background tasks, it's negligible.

**Token savings vs extra calls:** You save tokens on every LLM call (smaller tool descriptions), but you add 1-2 tool calls per workflow. The net is positive when tool descriptions are large or the agent makes many LLM calls.

**When NOT to use this pattern:**

- Single-purpose agents with <10 tools — the overhead isn't worth it
- Tools that are genuinely independent (no multi-step workflows)
- Prototyping — start with verbose descriptions and refactor to skills when the prompt gets unwieldy

**When it shines:**

- 10+ tools with multi-step procedures
- Multi-domain agents (support + billing + shipping + inventory)
- Teams sharing procedures across agents
- Tool definitions exceeding ~10K tokens

## Running the Demo

```bash
# Skills mode (default) — concise tools + get_skill meta-tool
pnpm dev:skill-injection

# No-skills mode — verbose tool descriptions (the anti-pattern)
pnpm dev:skill-injection:no-skills
```

After each response, the CLI shows prompt size stats so you can compare:

```
📊 Stats: 3 LLM calls, 4 tool calls (1 get_skill) [skills mode]
📏 Prompt size: 581 system + 2,847 tool defs = 3,428 total chars
```

vs.

```
📊 Stats: 3 LLM calls, 3 tool calls [no-skills mode]
📏 Prompt size: 349 system + 8,241 tool defs = 8,590 total chars
```

## In the Wild: Coding Agent Harnesses

Every major coding agent harness faces the same problem this pattern solves: as capabilities grow, stuffing everything into the system prompt becomes untenable. The solutions they've converged on are remarkably similar to on-demand skill injection -- a lightweight catalog always in context, with full instructions loaded only when needed.

**Claude Code** implements this pattern most explicitly through its [skill system](https://code.claude.com/docs/en/skills). Each skill is a `SKILL.md` file containing YAML frontmatter (name, description, invocation rules) and markdown instructions. At session start, Claude Code builds an `<available_skills>` list from the frontmatter of all discovered skills and embeds it in the Skill tool's description -- this is the catalog. When Claude determines a skill is relevant (either automatically from the description match, or when the user types a `/slash-command`), it calls the Skill tool, which responds with the full SKILL.md body and the skill's base filesystem path. The instructions expand into context only at that moment. This is exactly the two-layer architecture from this demo: cheap catalog always present, expensive instructions loaded on demand. Skills can be scoped to a project (`.claude/skills/`), a user (`~/.claude/skills/`), or an entire organization via managed settings -- and the catalog budget scales dynamically at 2% of the context window to prevent the catalog itself from becoming bloat.

**Cline** arrived at the same insight from a different angle. Its [context optimization framework](https://cline.bot/blog/inside-clines-framework-for-optimizing-context-maintaining-narrative-integrity-and-enabling-smarter-ai) replaced static MCP instructions that consumed roughly 30% of the system prompt with a `load_mcp_documentation` tool. Instead of embedding ~8,000 tokens of MCP guidance in every request, Cline now retrieves that documentation only when the user is actively working with MCP servers. The savings are significant: most development sessions never touch MCP, so those tokens were pure waste. This is the `get_skill` meta-tool pattern applied to infrastructure documentation rather than workflow procedures -- the principle is identical.

**Roo Code** takes a structural approach through its [mode system](https://docs.roocode.com/basic-usage/using-modes). Rather than loading and unloading individual skills, Roo Code swaps entire capability profiles. Each mode (Code, Ask, Architect, Debug, Orchestrator) defines a distinct system prompt, tool group access (read, edit, command, mcp), and behavioral instructions. Switching from Architect mode to Code mode is like calling `get_skill` for an entire persona -- the agent's available tools, permissions, and instructions all change at once. The Orchestrator mode is especially notable: it has no direct file tools at all and can only delegate to other modes, making it a pure skill-routing layer. Modes can request switches to other modes via the [`switch_mode` tool](https://docs.roocode.com/advanced-usage/available-tools/switch-mode), so the agent itself decides when to load a different capability set.

**GitHub Copilot** extends capabilities dynamically through [MCP server configuration](https://docs.github.com/en/copilot/tutorials/enhance-agent-mode-with-mcp). Repository administrators define MCP servers in JSON configuration, and the tools from those servers become available to Copilot's agent mode during task execution. This is skill injection at the infrastructure level -- rather than embedding tool instructions in the prompt, external servers provide capabilities on demand through a standardized protocol. Default MCP servers (GitHub data, Playwright for web interaction) ship preconfigured, while project-specific servers add domain capabilities without inflating the base prompt.

The convergence across these harnesses validates a core claim of this pattern: as agent capability grows, progressive disclosure stops being an optimization and becomes a requirement. Claude Code's skill catalog, Cline's on-demand documentation loading, Roo Code's mode switching, and Copilot's MCP extensibility are all implementations of the same idea -- keep the index cheap, load the instructions when you need them.

## Key Takeaways

1. **Context bloat degrades LLM performance** — research shows 13.9%–85% degradation even with perfect retrieval. Shorter, focused prompts outperform longer ones.

2. **Skill injection is progressive disclosure for agents** — the catalog tells the model _what_ skills exist (cheap), `get_skill` loads _how_ to execute them (only when needed).

3. **Dynamic filtering keeps the catalog honest** — skills that depend on unavailable tools are automatically hidden. No stale or broken options.

4. **The LLM is the retrieval system** — for typical skill counts (4-20), enum-constrained selection is more reliable than embedding-based retrieval and requires no indexing infrastructure.

5. **Measure the prompt, not just the answer** — the real comparison is total prompt size across the full conversation. Skills mode pays a small upfront cost (one extra tool call) but saves on every subsequent LLM call.

## Sources & Further Reading

- [Anthropic — Tool Use Best Practices](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/best-practices-and-limitations) — progressive disclosure, tool search pattern
- [Du & Tian (2025) — "What if LLMs Have a Long Context but Can't Use It?"](https://arxiv.org/abs/2502.08003) — degradation with context length
- [Liu et al. (2024) — "Lost in the Middle"](https://arxiv.org/abs/2307.03172) — U-shaped attention in long contexts
- [Wang et al. (2023) — Voyager](https://arxiv.org/abs/2305.16291) — skill library for embodied agents (3.3x more items, 15.3x faster milestones)
- [Xu et al. (2025) — SkillWeaver](https://arxiv.org/abs/2502.07869) — skill extraction from demonstrations (31-40% improvement)
- [OpenAI — Function Calling Guide](https://platform.openai.com/docs/guides/function-calling) — tool count limits and best practices
- [Vercel AI SDK — Multi-Step Tool Use](https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling) — progressive tool patterns
- Previous concept: [Declarative Plan Execution](../declarative-plan/README.md)
