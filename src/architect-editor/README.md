# Two Brains Are Better Than One: The Architect/Editor Model Split

When you ask a coding agent to fix a bug, it faces two simultaneous challenges: _figuring out what to change_ and _producing exactly the right file edit format_. These sound like the same task, but research shows they are not — and combining them in a single model prompt degrades both.

The Architect/Editor Model Split routes those two jobs to separate models. The **architect** reasons freely about what needs changing. The **editor** takes that plan and applies it mechanically. Aider demonstrated a +5.3 percentage point improvement on SWE-bench Verified with this pattern. Even pairing the same model with itself — Claude 3.5 Sonnet acting as both architect and editor — beats single-model Claude 3.5 Sonnet by 3.1 points.

This is the pattern behind Claude Code's plan mode, Cursor's Instant Apply, and Aider's `--architect-model` flag.

[Agent Patterns — TypeScript](../../README.md) · Builds on: [Cost Tracking & Model Selection](../cost-tracking/README.md), [File Edit Strategies](../file-edit-strategies/README.md)

---

## The Interference Hypothesis

When a model produces a code edit, it must solve two competing problems at once:

1. **Reasoning**: What is the bug? What needs to change? Which lines are affected?
2. **Formatting**: Produce a syntactically exact `old_str` that uniquely matches the file, with the correct whitespace, indentation, and punctuation.

These tasks pull on the same attention budget. A model trying to solve a tricky bug is less precise about formatting. A model constrained by strict format requirements is less creative about reasoning. Aider's team described it as a model "splitting its attention between solving the coding problem and conforming to the edit format."

Four independent sources confirmed this in 2024-2025:

- **Aider (empirical, Sept 2024)**: Same-model architect/editor pairs consistently outperform single-model on SWE-bench
- **Deco-G paper (arxiv:2510.03595)**: Decoupling reasoning from formatting constraints yields 1-6% improvement with guaranteed format compliance
- **Cognitive Load Limits paper (arxiv:2509.19517)**: Context saturation degrades performance when a model must multitask reasoning and formatting
- **MSARL paper (arxiv:2508.08882)**: Explicit reasoning/tool-agent splits "significantly improve reasoning stability and final-answer accuracy"

The fix is simple: give each model only one job.

---

## The Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  User: "Change the pasta to 350g and reduce servings to 3"   │
└──────────────────────────────────┬───────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│  ARCHITECT  (powerful reasoning model)                       │
│                                                              │
│  Input:  user request + current file content                 │
│  Tools:  none — free-form text output only                   │
│  Output: "Change '400g spaghetti' to '350g spaghetti' in     │
│           the Ingredients section. Change 'Serves: 4' to    │
│           'Serves: 3' in the header."                        │
└──────────────────────────────────┬───────────────────────────┘
                                   │ natural language plan
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│  EDITOR  (smaller, cheaper model)                            │
│                                                              │
│  Input:  architect's plan                                    │
│  Tools:  read_file, edit_file                                │
│  Output: tool calls applying the exact search/replace        │
└──────────────────────────────────┬───────────────────────────┘
                                   │
                                   ▼
                          Updated recipe file
```

The key asymmetry: the architect's task (understand a problem) is cognitively harder but produces only a few hundred tokens of natural language. The editor's task (apply a described solution) is cognitively simpler and can be handled by a smaller, cheaper model — even a fine-tuned one.

---

## Architect Prompt Design

The architect prompt omits everything related to file editing. No mention of tools, `old_str`, search/replace, or uniqueness constraints. The model is free to reason:

```typescript
const ARCHITECT_SYSTEM = `You are an expert recipe developer.

The user will ask you to modify a recipe. Your job is to describe, in plain
English, exactly what changes need to be made.

Be specific. Instead of "update the pasta quantity", write "change '400g
spaghetti' to '350g spaghetti' in the Ingredients section".

Do NOT produce file edits, code blocks, or formatted patches. Describe WHAT
to change, not HOW to format the edit. Your output will be read by a separate
file-editing model that handles the mechanics.`;
```

The architect also receives the current file content injected directly into the user message — it doesn't need tools to read it:

```typescript
const augmentedMessage = `Here is the current recipe:\n\n\`\`\`\n${fileContent}\`\`\`\n\nRequest: ${userMessage}`;
```

This single call produces a natural language plan like:

> Change `'400g spaghetti'` to `'350g spaghetti'` in the Ingredients section. Also change `'Serves: 4'` to `'Serves: 3'` in the header.

---

## Editor Prompt Design

The editor prompt contains only file editing mechanics. No reasoning, no understanding of the original request — just apply what's described:

```typescript
const EDITOR_SYSTEM = `You are a file editing assistant.

The changes to apply to the recipe file have already been worked out.
Your job is to apply them precisely.

EDITING WORKFLOW:
1. Call read_file("carbonara.md") to see the current content.
2. For each change, call edit_file with:
   - old_str: the exact text to replace (include neighboring lines for context)
   - new_str: the replacement text
3. If "No match found" → re-read and adjust old_str.
4. If "Found multiple matches" → add more surrounding lines.

After all changes are applied, briefly confirm what was done.`;
```

The editor receives the architect's plan as its entire task — it doesn't know what the user asked for, only what needs to happen:

```typescript
// runEditor's first message — the plan, not the original user request
{ role: "user", content: `Apply the following changes to ${RECIPE_FILE}:\n\n${plan}` }
```

This reduced context is both the efficiency gain and the correctness gain. The editor isn't distracted by the user's request — it only has to ask "does this plan describe what I need to do?" which is a much easier question than "does this plan correctly solve the user's problem?"

---

## The Two-Stage Call

```typescript
export async function runArchitectEditorPipeline(
  userMessage: string,
  history: Message[],
  models: { architect: string; editor: string },
): Promise<PipelineResult> {
  // Stage 1: Architect — single call, no tools
  const architect = await runArchitect(userMessage, models.architect);

  // Stage 2: Editor — ReAct loop with tools
  const editor = await runEditor(architect.plan, models.editor);

  // Thread the two responses into the main conversation as a single turn
  const messages: Message[] = [
    ...history,
    { role: "user", content: userMessage },
    { role: "assistant", content: `Plan: ${architect.plan}\n\nApplied: ${editor.summary}` },
  ];

  return { messages, architect, editor };
}
```

The architect and editor are fully independent. You can swap either without touching the other — different providers, different vendors, different capability tiers.

---

## Token Cost Analysis

The split changes _who_ generates each type of token:

**Single-model approach:**

- Expensive model handles: user message → reasoning → read_file call → edit_file call → confirmation
- All output tokens come from the same (expensive) model

**Dual-model approach:**

- Expensive architect: user message → reasoning plan (short output — just the plan)
- Cheaper editor: plan → read_file call → edit_file call → confirmation

The expensive model's output tokens drop dramatically. In Aider's R1 + Sonnet pairing (January 2025), the R1 architect produced a compact plan while Claude Sonnet handled the mechanical editing — achieving 64.0% on the polyglot benchmark at **14× lower cost** than using o1 alone ($13.29 vs $186.50 per SWE-bench run).

This is the cost arbitrage: reasoning tokens are expensive (frontier model), formatting tokens are cheap (smaller specialized model).

---

## Benchmark Results

The pattern produces consistent improvements across model families and benchmarks:

| Approach                      | SWE-bench Verified | Notes                                    |
| ----------------------------- | ------------------ | ---------------------------------------- |
| o1-preview solo               | 79.7%              | Single model baseline                    |
| o1-preview + DeepSeek editor  | **85.0%**          | +5.3pp                                   |
| Claude 3.5 Sonnet solo        | 77.4%              |                                          |
| Sonnet + Sonnet (arch/editor) | **80.5%**          | +3.1pp — _same model, different prompts_ |
| GPT-4o solo                   | 71.4%              |                                          |
| GPT-4o + GPT-4o (arch/editor) | **75.2%**          | +3.8pp                                   |
| R1 + Sonnet                   | 64.0%              | 14× cheaper than o1 solo                 |
| o3-high + GPT-4.1             | **83.0%**          | Apr 2025 SOTA for this pattern           |

The same-model results (+3.1pp for Sonnet+Sonnet) are the most striking: the only change is splitting the task across two prompts with different system instructions. No stronger model is involved. The improvement comes entirely from reducing prompt interference.

Format compliance also improves: Qwen2.5-Coder solo produced well-formed edits in 92% of cases; with architect mode, that rose to 100%.

---

## Speculative Edits: The Physical Limit

Cursor pushed the editor optimization further by observing something interesting: when a model rewrites a file, most output tokens are _identical to the input file_. An edit that changes three lines in a 200-line file produces ~197 unchanged tokens.

Speculative decoding exploits this. The original file is sent as a "prediction" — the model validates matching tokens instantly, then only generates the changed sections from scratch. Cursor's result: ~1,000 tokens/second (versus ~80 tok/s for Claude Sonnet), with near-instant file application in the IDE.

This optimization is only possible because the editor is separate — it receives the original file and produces a rewrite, enabling prefix speculation. The architect's reasoning output isn't predictable this way.

Morph Fast Apply takes this further with a dedicated 7B model that achieves 10,500 tok/s at $0.80/M tokens (versus $15/M for Claude Sonnet), with 98% merge accuracy. A 7B specialist beats a frontier model for the mechanical application task.

---

## When to Split (and When Not To)

**Split when:**

- Using a reasoning-focused model (o1, R1, o3) as the architect — these models are strong reasoners but poor formatters
- The edit format is complex or strict (diffs, search/replace, structured patches)
- Cost matters — you want frontier reasoning with cheaper editing
- The file is long — the editor can use speculative decoding on the existing content
- Format compliance failures are causing retries

**Stay single-model when:**

- The request is simple and the model handles both tasks reliably
- Latency is critical — two sequential LLM calls add wall-clock time
- The frontier model you're using produces correct edits on the first try
- File size is small enough that format errors are rare

**The 2025 nuance:** Frontier models have improved dramatically. GPT-5 solo achieves 88% on SWE-bench — higher than the best o3+GPT-4.1 architect/editor pair at 83%. For top models on well-formatted tasks, the split may not improve raw accuracy. But Morph's data shows specialized apply still achieves 100% merge success versus 84-96% for search-replace, with 2-3.5× fewer retries. The pattern's value has shifted from accuracy gains to **correctness guarantees and cost arbitrage**.

---

## In the Wild: Coding Agent Harnesses

Every major coding agent harness independently converged on this pattern.

### Aider — Where It Started

Aider pioneered the architect/editor split in September 2024, motivated by o1-preview being an exceptional reasoner but a poor formatter. Their implementation exposes an `--editor-model` flag; the architect is the main `--model` setting.

The editor in Aider uses a simplified system prompt with only file editing mechanics. The architect receives the full problem context. Aider's editor supports two formats — `editor-diff` (search/replace) and `editor-whole` (full file rewrite) — and picks based on the configured editor model. Their benchmark data showed that the pairing helps most when the architect is a reasoning-optimized model and the editor is a coding-optimized model. The R1 + Sonnet pairing achieves 64% on the polyglot benchmark at 14× lower cost — one of the clearest cost-arbitrage wins in the literature.

Not all pairings help: o1 + Sonnet did not improve over o1 alone, suggesting that when the architect model is already good at formatting, the split adds only latency.

### Cursor — Fine-Tuned Apply at Scale

Cursor built a custom fine-tuned Llama-3-70B as their apply model ("Instant Apply"). Their key design choices differ from Aider's:

- **Full-file rewrite** rather than diffs — because diffs require accurate line numbers at the _first_ output token, which is hard for any model under speculative decoding constraints
- **80/20 real/synthetic training data** from their CMD+K prompts — the editor was trained on actual Cursor usage patterns
- **Speculative decoding via Fireworks AI** — the original file is sent as a "speculation" payload; the server validates matching prefixes greedily (temperature=0) and accepts the longest match before continuing generation
- Result: ~1,000 tokens/second, 13× faster than vanilla Llama-3-70B inference

The Fireworks infrastructure is worth examining: the `speculation` field is sent in the API request, the server handles all the prefix matching internally, and the output is provably identical to full inference. The client changes are minimal — Cursor just sends the original file alongside the request.

### Claude Code — Capability Tiers

Claude Code's plan mode implements the split at the capability tier level. When you enter plan mode, Claude uses a more capable model for the planning stage and a faster model for execution. The architecture is the same conceptual split: deliberate reasoning separated from mechanical application.

This generalizes beyond code editing: the pattern applies to any multi-step agent task where upfront reasoning produces a plan that a cheaper/faster model can execute.

### Cline — Cross-Provider Routing

Cline (the VS Code extension) applies the pattern cross-provider: Gemini 2.5 Pro for planning, Claude Sonnet for execution. The architect and editor don't need to be from the same provider — you can route based on capability profile. Gemini 2.5 Pro's 1M-token context makes it strong for architectural reasoning over large codebases; Claude Sonnet's reliable tool use makes it strong for executing precise edits.

This cross-provider flexibility is enabled by the clean interface between stages: the architect outputs natural language, the editor receives natural language. No model-specific format assumptions cross the boundary.

---

## The 2025 Debate: Is This Pattern Obsolete?

In mid-2025 a counter-argument emerged: top frontier models now produce well-formed edits without a cleanup stage. GPT-5 solo achieves 88% on SWE-bench, beating the best architect/editor combo at 83%. Claude Code uses single-model `str_replace` natively. Devin reportedly abandoned fast-apply models. The argument: for top models on standard tasks, the split adds latency without accuracy gains.

The counter-data: Morph shows their 7B apply model achieves 100% merge success versus 84-96% for search-replace, with 2-3.5× fewer retries on failure. The pattern's value isn't just raw benchmark scores — it's:

1. **Cost arbitrage**: Using a $0.80/M token apply model instead of $15/M Claude for the mechanical stage
2. **Correctness guarantees**: Specialized apply models have lower merge failure rates
3. **Speed**: 10,500 tok/s for a 7B apply model vs ~80 tok/s for Claude Sonnet
4. **Pairing reasoning models**: R1, o1, and o3 are strong reasoners but poor formatters — the split unlocks their reasoning without their formatting limitations

The pattern is most valuable when the gap between reasoning quality and formatting quality is large. As frontier models close that gap, the case for splitting narrows — but the cost argument remains.

---

## Key Takeaways

- **The interference hypothesis is real**: forcing a single model to reason and format simultaneously degrades both, confirmed by 4 independent research groups
- **Same-model pairing still helps**: Sonnet+Sonnet beats single-model Sonnet by 3.1pp — the improvement comes from prompt separation, not model power
- **The editor can be much smaller**: a 7B apply model can exceed frontier accuracy for the application task at 100× lower cost
- **Speculative decoding is the physical limit**: the editor stage enables prefix speculation because most edit tokens are unchanged — this is architecturally impossible with a single model
- **All major harnesses use this**: Aider, Cursor, Claude Code, and Cline independently converged on separating reasoning from application
- **2025 nuance**: the pattern's value has shifted from accuracy gains to cost arbitrage and correctness guarantees as frontier models improve

---

## Running the Demo

```bash
# Default: qwen2.5:14b as architect, qwen2.5:7b as editor
pnpm dev:architect-editor

# Custom models via env vars
ARCHITECT_MODEL=qwen2.5:14b EDITOR_MODEL=qwen2.5:3b pnpm dev:architect-editor
```

**Commands:**

- `/recipe` — show the current recipe file
- `/compare` — run BOTH single-model and dual-model on the next message, then show token breakdown

**Sample requests:**

- `"Add a note that this recipe is nut-free"`
- `"Change pasta to 350g and reduce servings to 3"`
- `"Add a tip about using room-temperature eggs before step 3"`
- `"Update the guanciale note to mention lardon as another substitute"`

---

## Sources & Further Reading

- [Aider — Architect Mode](https://aider.chat/2024/09/26/architect.html) — original architect/editor design with SWE-bench results and same-model pairing data
- [Aider — R1 + Sonnet Results](https://aider.chat/2025/01/24/r1-sonnet.html) — 14× cost reduction with reasoning model as architect
- [Cursor — Instant Apply](https://cursor.com/blog/instant-apply) — fine-tuned Llama-3-70B with speculative decoding and full-file rewrite approach
- [Fireworks AI — Cursor Fast Apply Infrastructure](https://fireworks.ai/blog/cursor) — speculation API field, prefix matching, provably identical output
- [Martin Fowler — Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html) — the "execution control" dimension of agent design
- [Morph Fast Apply](https://morph.so) — 7B model at 10,500 tok/s, $0.80/M tokens, 100% merge success
- Deco-G (arxiv:2510.03595) — formal analysis of format-reasoning interference in LLMs
- EfficientEdit (arxiv:2506.02780, ASE 2025) — edit-oriented speculative decoding with 10-13× speedups
