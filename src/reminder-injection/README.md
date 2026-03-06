# Tool-Response Reminder Injection

[Agent Patterns — TypeScript](../../README.md) · Builds on [Tool Description Engineering](../tool-descriptions/README.md)

---

Your agent follows instructions perfectly for the first few tool calls. By tool call 10, it's forgotten half the rules. Source citations vanish. Imperial units leak through unconverted. Allergen tags disappear. This isn't a bug in your prompt — it's a fundamental property of how transformers allocate attention.

**Tool-response reminder injection** is the one-line fix: append a short block of critical rules to every tool result before it enters the conversation history. The model reads tool responses right before generating its next output, making them the highest-attention position in the context. Place your rules there, and they stay in the model's effective working memory across 10, 20, or 50 tool calls.

```
┌──────────────────────────────────────────────────────────────────┐
│ System Prompt (beginning of context — high attention initially) │
│ "Always cite sources, use metric units, tag allergens..."       │
├──────────────────────────────────────────────────────────────────┤
│ User: "Plan a 4-course Italian dinner"                          │
├──────────────────────────────────────────────────────────────────┤
│ Assistant → tool_call: search_recipes("appetizer")              │
│ Tool result: { recipes: [...] }                                 │
│ ┌─────────────────────────────────────────┐                     │
│ │ <system-reminder>                       │ ← INJECTED          │
│ │ 1. Cite sources  2. Metric only  ...    │                     │
│ │ </system-reminder>                      │                     │
│ └─────────────────────────────────────────┘                     │
├──────────────────────────────────────────────────────────────────┤
│ Assistant → tool_call: get_recipe_details("Bruschetta")         │
│ Tool result: { ingredients: [...], steps: [...] }               │
│ ┌─────────────────────────────────────────┐                     │
│ │ <system-reminder>                       │ ← INJECTED AGAIN    │
│ │ 1. Cite sources  2. Metric only  ...    │                     │
│ │ </system-reminder>                      │                     │
│ └─────────────────────────────────────────┘                     │
├──────────────────────────────────────────────────────────────────┤
│ ...10 more tool calls, each with the reminder appended...       │
├──────────────────────────────────────────────────────────────────┤
│ Assistant: final response ← sees reminder at recency position   │
└──────────────────────────────────────────────────────────────────┘
```

## Why Instructions Drift

Three converging mechanisms explain why a model stops following its system prompt:

**1. Positional attention decay.** The "Lost in the Middle" paper (Liu et al., 2023) showed that LLM accuracy follows a U-shaped curve: highest when relevant information is at the beginning or end of context, lowest in the middle. As tool calls accumulate, the system prompt — originally at the top — slides into the low-attention middle zone. In the 20-document setting, GPT-3.5-Turbo's accuracy at the worst middle position dropped to 52.9% — _below_ the closed-book baseline.

**2. Multi-turn reliability collapse.** "LLMs Get Lost In Multi-Turn Conversation" (Laban et al., 2025) tested 200,000+ conversations across 15 LLMs and found a **39% average performance drop** from single-turn to multi-turn. The key finding: this is primarily a _reliability_ problem (+112% unreliability increase), not an aptitude one. Models still _can_ answer correctly — they just do so inconsistently. Degradation begins with as few as 2 turns.

**3. Recency bias from causal attention.** Causal transformers can only attend backward — each token sees all previous tokens but none after it. This creates a structural recency bias: tokens near the generation point receive disproportionate attention weight. The "Prompt Repetition" paper (Leviathan et al., 2025) showed that simply repeating the input prompt improved accuracy in **47 out of 70 benchmark-model tests with zero losses** — one task jumped from 21% to 97%.

The implication: the best place to put instructions you want the model to follow is right before the generation point. In a ReAct loop, that's the tool response.

## The One-Line Fix

The entire implementation is a wrapper function:

```typescript
// reminder.ts
const REMINDER_BLOCK = `
<system-reminder>
CRITICAL FORMATTING RULES — apply to ALL responses:
1. ALWAYS cite sources: [Source: <name>] after every recipe/wine mention
2. ONLY metric units (grams, ml, °C) — NEVER cups, oz, or °F
3. End every dish with: ⚠️ Allergens: <list>
4. Number steps as "Step N:" — never bare numbers or bullets
5. Prefix dishes with course: [Appetizer], [Primo], [Secondo], [Dessert]
</system-reminder>`;

export function wrapToolResponse(result: string): string {
  return result + REMINDER_BLOCK;
}
```

And one conditional in the agent loop:

```typescript
// agent.ts — the only change from a standard ReAct loop
const rawResult = executeTool(name, args);
const result = mode === "reminders" ? wrapToolResponse(rawResult) : rawResult;
messages.push({ role: "tool", content: result });
```

That's it. Same system prompt, same tools, same model. The only variable is whether tool responses carry the reminder suffix.

## The Demo: Italian Dinner Party Planning

The demo uses an Italian dinner party planning domain that naturally triggers 10-13 sequential tool calls:

| Tool                            | What it does                                             |
| ------------------------------- | -------------------------------------------------------- |
| `search_recipes`                | Find recipes by course (appetizer/primo/secondo/dessert) |
| `get_recipe_details`            | Full recipe with ingredients, steps, timing              |
| `search_wine_pairings`          | 2 wine recommendations per dish                          |
| `check_ingredient_availability` | Seasonal availability check                              |
| `calculate_shopping_list`       | Aggregate all ingredients, scaled for guest count        |
| `estimate_prep_timeline`        | Cooking schedule working backwards from serving time     |

### Deliberate Drift Triggers

The mock data includes imperial units designed to tempt the model:

```json
"ingredients": [
  "1 cup fresh basil leaves",        // should convert → ~24g
  "2 tablespoons black peppercorns", // should convert → ~12g
  "1/2 cup all-purpose flour"        // should convert → ~60g
],
"steps": [
  "Grill bread at 400°F",            // should convert → 200°C
  "Braise in oven at 325°F"          // should convert → 160°C
]
```

Without reminders, the model echoes these values directly after enough tool calls. With reminders, it consistently converts to metric.

### Running the Demo

```bash
# With reminders — consistent formatting throughout
pnpm dev:reminder-injection

# Without reminders — watch formatting drift after tool call 8-10
pnpm dev:reminder-injection:no-reminders
```

Use this prompt to trigger the full tool chain:

> Plan a 4-course Italian dinner party for 6 guests. Search recipes for each course, get full details for the best option per course, find wine pairings, check ingredient availability, build a shopping list, and create a prep timeline for 7 PM service.

### What to Watch For

| Rule             | Without Reminders (drift)                 | With Reminders (stable)                |
| ---------------- | ----------------------------------------- | -------------------------------------- |
| Source citations | Disappear by tool call 6-8                | Present throughout                     |
| Metric units     | Imperial leaks through ("1 cup", "400°F") | Consistently converted to grams/ml/°C  |
| Allergen tags    | Dropped on later courses                  | Every dish tagged                      |
| Step numbering   | Switches to bullets or bare numbers       | "Step N:" format maintained            |
| Course labels    | Omitted or inconsistent                   | [Appetizer]/[Primo] etc. on every dish |

## Design Decisions

### Reminder Size: ~85 Tokens

The reminder block is intentionally short. Research supports this:

- OpenAI's GPT-4.1 guide found that **3 lines of text** (~50 tokens) improved SWE-bench scores by ~20%
- The SCAN protocol recommends ~120-300 tokens depending on task criticality
- Anthropic's sub-agent summaries target 1,000-2,000 tokens — but reminders shouldn't be summaries

Every token in a reminder displaces a token of useful context. The goal is the smallest set of high-signal tokens that maintain the desired behavior.

### Every Tool Call vs. Periodic Injection

This demo injects on every tool call. The alternatives:

| Strategy                             | Tradeoff                                              |
| ------------------------------------ | ----------------------------------------------------- |
| Every tool call                      | Highest adherence, highest token cost                 |
| Every N tool calls                   | Saves tokens, but drift can start between injections  |
| Only after long gaps                 | Cheapest, but reactive — fixes drift after it happens |
| Adaptive (detect drift, then inject) | Most complex, requires a drift detector               |

OpenAI's GPT-5 guide specifically recommends re-injecting formatting instructions "every 3-5 user messages." The "Prompt Repetition" paper found that 3x repetition substantially outperforms 2x — suggesting more frequent injection is generally better when token budget allows.

### `<system-reminder>` Tag Format

The tag format is borrowed from Claude Code's production architecture. The tag serves two purposes:

1. **Semantic boundary** — tells the model this is meta-instruction, not tool output data
2. **Attention cue** — XML-style tags create a recognizable pattern the model has seen in training

Claude Code uses the same `<system-reminder>` tags, with the system prompt explicitly teaching: _"system-reminder tags contain useful information and reminders. They are NOT part of the user's provided input or the tool result."_

### What to Put in the Reminder

Include rules that are:

- **Observable** — you can check whether the output follows them (formatting, citations, units)
- **Prone to drift** — rules the model tends to forget (metric conversion, allergen tags)
- **Concise** — one line per rule, imperative voice

Don't include:

- Full system prompt repeats (wastes tokens, dilutes signal)
- Vague guidance ("be helpful") — the model won't drift from these anyway
- Rules that are already reinforced by tool schemas or descriptions

## Where the Research Disagrees

### Passive Injection vs. Active Generation

The SCAN protocol argues that **generating** responses to reminder questions (~300 tokens of model output) creates stronger attention connections than **passively reading** injected reminders. The idea: token generation forces the model to actively re-engage with the system prompt sections, creating stronger bidirectional attention.

This demo uses passive injection (appending text to tool responses). The SCAN approach would instead insert questions like _"What data will this task affect?"_ and require the model to answer them before proceeding.

No rigorous A/B study has compared these approaches. SCAN's proponent reports production success across 11 agents, but without published benchmarks. The mechanism is plausible — active recall is well-established in human learning — but unproven for transformers.

### Architecture-Level Prevention vs. Injection

Anthropic's published guidance emphasizes **architectural** solutions: compaction, sub-agent delegation, structured note-taking. Their view: keep the context clean rather than patching dirty context with reminders.

OpenAI's guidance is the opposite: inject reminders directly. Their GPT-4.1 prompting guide recommends three specific reminder lines that "transformed the model from a chatbot-like state into a much more 'eager' agent."

MiniMax takes a third position: "Start with a minimal system prompt, then iteratively tighten behavioral boundaries based on real-world performance." They advocate against heavy instruction reinforcement entirely.

In practice, most production systems combine approaches — Claude Code uses both architectural solutions (sub-agents, context compaction) _and_ aggressive reminder injection.

### Token Cost: The Claude Code Warning

Claude Code's implementation of reminder injection shows the cost ceiling. Community forensic analysis found:

- **10,577 hidden injections** across 538 files over 32 days
- **~15% direct context overhead** (30-50% effective with compaction)
- File modification reminders sometimes inject **entire file contents** (1,500+ lines)

This demo's ~85-token reminder is conservative by comparison. At 13 tool calls, that's ~1,105 tokens of overhead — roughly 5% of a 20K-token conversation. But the lesson from Claude Code is clear: unbounded injection can eat your context budget. Any production system needs cost caps.

## In the Wild: Coding Agent Harnesses

Reminder injection is one of the most widely adopted patterns across coding agent harnesses, though implementations diverge significantly.

**Claude Code** is the most aggressive injector. It uses `<system-reminder>` XML tags appended to tool results and user messages, with ~40 documented reminder types covering file modifications, security checks, plan mode state, todo list nudges, and more. The system prompt explicitly instructs the model that these tags "contain useful information and reminders" and are "NOT part of the user's provided input or the tool result." Reminders are hidden from the UI via an `isMeta` flag — the user never sees them.

**Cursor** independently arrived at nearly the same pattern, using `<system_reminder>` tags (underscore instead of hyphen) in tool results and user messages. Their system prompt echoes Claude Code's: "Please heed them, but don't mention them in your response to the user." Cursor adds bounded recursion rules ("Do NOT loop more than 3 times on fixing linter errors") as reminder content — using the mechanism for behavioral guardrails, not just formatting.

**OpenCode** (open-source CLI agent) directly adopted Claude Code's `<system-reminder>` format. When the `read` tool accesses files in subdirectories, it walks up the directory tree looking for instruction files (AGENTS.md, CLAUDE.md) and injects any new ones as `<system-reminder>` blocks in the tool output. A per-message claims system prevents duplicate injection.

**Aider** takes a fundamentally different approach: all reinforcement happens at prompt construction time via template variables like `{final_reminders}` and `{system_reminder}`. There's no mid-conversation injection. The same rule ("ONLY EVER RETURN CODE IN A _SEARCH/REPLACE BLOCK_!") appears at least twice in the constructed prompt — exploiting both primacy and recency — but once the conversation starts, nothing new is injected. This is cheaper but offers no protection against mid-session drift.

**Manus** uses the most novel alternative: filesystem-based recitation. Instead of injecting reminders into messages, the agent creates and continuously updates a `todo.md` file. Each time it references the file, the current plan enters the recent attention window. The Manus team explicitly calls this out as addressing "lost in the middle" — pushing the global plan into recency position without consuming message-level tokens.

The spectrum from Aider (zero mid-conversation injection) to Claude Code (40+ reminder types, 15%+ context overhead) reflects a genuine architectural tradeoff with no consensus best answer.

## Key Takeaways

1. **Instruction drift is real and measurable.** 39% average performance drop in multi-turn settings, with unreliability more than doubling. It starts after just 2 turns.

2. **Tool responses are the optimal injection point.** In a ReAct loop, tool results are the last tokens before the model's next generation — the highest-attention position due to recency bias. Placing reminders here is more effective than re-injecting into the system prompt.

3. **The fix is trivially simple.** One function (`wrapToolResponse`) and one conditional in the agent loop. No architectural changes, no new dependencies, no model fine-tuning.

4. **Keep reminders small.** ~85-150 tokens of high-signal, observable, drift-prone rules. Every unnecessary token displaces useful context. OpenAI found that 3 lines (~50 tokens) improved SWE-bench by 20%.

5. **Watch the token budget.** Claude Code's experience shows that unbounded injection can consume 15-50% of context. Set a ceiling and monitor overhead relative to useful content.

6. **This is a complement, not a replacement.** Reminder injection works alongside architectural solutions (sub-agents, context compaction, shorter sessions). The best production systems use both.

## Sources & Further Reading

- [Lost in the Middle (arXiv:2307.03172)](https://arxiv.org/abs/2307.03172) — U-shaped attention curve proving middle-position degradation
- [Drift No More (arXiv:2510.07777)](https://arxiv.org/abs/2510.07777) — formalizes drift, shows goal-reminder interventions reduce KL divergence by up to 67%
- [LLMs Get Lost In Multi-Turn Conversation (arXiv:2505.06120)](https://arxiv.org/abs/2505.06120) — 39% multi-turn performance drop across 15 LLMs
- [Prompt Repetition Improves Non-Reasoning LLMs (arXiv:2512.14982)](https://arxiv.org/abs/2512.14982) — 47/70 wins from simple prompt repetition
- [Attention Sorting (arXiv:2310.01427)](https://arxiv.org/abs/2310.01427) — exploiting recency bias by reordering context
- [Anthropic — Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — "context rot" and architectural countermeasures
- [Anthropic — Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — re-injection of key instructions across context windows
- [OpenAI — GPT-4.1 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide/) — three agent reminders, ~20% SWE-bench improvement
- [OpenAI — GPT-5 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide) — "re-inject formatting instructions every 3-5 user messages"
- [SCAN Protocol — A 300-Token Fix for Prompt Drift](https://dev.to/nikolasi/solving-agent-system-prompt-drift-in-long-sessions-a-300-token-fix-1akh) — generative anchoring practitioner approach
- [Runtime Reinforcement: Preventing Instruction Decay](https://towardsai.net/p/machine-learning/runtime-reinforcement-preventing-instruction-decay-in-long-context-windows) — just-in-time interceptor architecture
- [Augment Code — Prompts Are Infrastructure](https://www.augmentcode.com/blog/prompts-are-infrastructure-building-agents-that-actually-listen) — multi-layer reinforcement philosophy
- [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) — filesystem-based recitation, KV-cache priority
