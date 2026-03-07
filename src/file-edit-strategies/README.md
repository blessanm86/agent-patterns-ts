# File Edit Strategies: How Agents Actually Edit Your Files

[Agent Patterns — TypeScript](../../README.md) · builds on [Tool Description Engineering](../tool-descriptions/README.md)

---

Every AI coding agent has the same deceptively simple job: take the LLM's intent and write it to disk. This "last mile" step — between _what the model decided to change_ and _which bytes actually flip in the file_ — is where most agent failures happen.

The LLM sees a representation of a file, reasons about what should change, and must describe the change precisely enough that a text-processing algorithm can locate the right spot and swap the bytes. The problem: LLMs are probabilistic text generators. File editing requires deterministic, exact mutations. The format the agent uses to express edits, and the matching algorithm it uses to apply them, are the entire bridge between these two worlds.

This concept explores the full landscape of edit strategies — from the simplest whole-file replacement to the sophisticated two-model pipelines used by production harnesses — and builds a working agent that demonstrates the core tradeoffs in practice.

---

## The Five Edit Strategies

Every harness in production today lands somewhere on this spectrum:

```
WHOLE FILE          SEARCH/REPLACE         UNIFIED DIFF          SEMANTIC PATCH        APPLY MODEL
───────────        ──────────────────      ──────────────        ──────────────────    ─────────────
Replace the        Find exact text,        Standard git           Context anchors        Second LLM
entire file        swap it out             diff format           instead of line #s     applies the
                                                                                        change
←── simpler, more reliable ───────────────────────────────── more efficient, fragile ──→
```

### 1. Whole-File Replacement

The model returns the complete updated file. The runner replaces the file atomically.

````
src/menu.ts
```typescript
export const menu = {
  // ... full file content ...
};
````

```

**Strengths:** Trivial to apply (no matching), works with any model, impossible to miss the target.

**Weaknesses:** Token cost scales with file size, not change size. A one-line fix in a 500-line file still requires generating 500 lines. Models also tend to *elide* unchanged code with lazy comments (`// ... rest of file unchanged`), corrupting the output.

**When it wins:** Small files (< 100 lines), apply-model architectures where a fine-tuned model handles the rewrite, and as a fallback when all other strategies fail.

Aider's benchmarks show GPT-4o-mini scores only 3.6% with diff formats but meaningfully higher with whole-file — for weaker models, the simplicity advantage is real.

---

### 2. Search/Replace Blocks

The model outputs pairs of delimited blocks: the text to find, and the replacement.

```

<<<<<<< SEARCH
{ name: "Tiramisu", price: 8.00, description: "Classic Italian dessert" },
=======
{ name: "Tiramisu", price: 9.50, description: "Classic Italian dessert" },

> > > > > > > REPLACE

````

This is the most widely adopted format across production harnesses. The model only outputs what's changing — token cost is proportional to the size of the edit, not the file.

**The catch:** The SEARCH block must match the file. If the model adds an extra space, uses slightly different indentation, or reconstructs the line from memory with a subtle difference — the edit fails. This is why every serious implementation of search/replace adds a *matching cascade* (more on this below).

**Accuracy:** Diff-XYZ benchmark shows search/replace beats unified diff for edit *generation* across all strong models:

| Model | Search/Replace EM | Unified Diff EM |
|---|---|---|
| GPT-4.1 | 0.95 | 0.81 |
| Claude Sonnet | 0.94 | 0.82 |
| Qwen2.5-Coder 32B | 0.68 | 0.23 |

---

### 3. Unified Diff

The standard `git diff -u` format with `---`/`+++` file headers, `@@` hunk markers with line numbers, and `-`/`+` line prefixes.

```diff
--- a/menu.ts
+++ b/menu.ts
@@ -22,7 +22,7 @@
   desserts: [
-    { name: "Tiramisu", price: 8.00, description: "Classic Italian dessert" },
+    { name: "Tiramisu", price: 9.50, description: "Classic Italian dessert" },
     { name: "Panna Cotta", price: 7.00, description: "Vanilla cream with berry coulis" },
````

LLMs have seen enormous amounts of unified diff in their training data (every git commit message, every code review, every patch mailing list archive). In theory, this makes it a natural format.

In practice, it's fragile for _generation_ tasks because it requires accurate line numbers. Models are notoriously bad at counting lines. A hunk header with the wrong line count causes the entire patch to fail to apply at the right location.

Aider found that switching GPT-4 Turbo from search/replace to a modified unified diff format improved its benchmark score from 20% to 61% — a 3× improvement — specifically because the format reduced "lazy coding" (the tendency to replace code with `// ... add logic here ...`). The udiff format signals "this output will be parsed by a program" which nudges models toward completeness.

---

### 4. Semantic Patch (Codex V4A Format)

OpenAI's custom patch format for GPT-4.1 and Codex replaces line numbers with _semantic anchors_ — the names of functions and classes near the change.

```
*** Begin Patch
*** Update File: src/api.js
@@ async function fetchUserData(userId) {
-  const response = await fetch(`/api/users/${userId}`);
-  const data = await response.json();
-  return data;
+  try {
+    const response = await fetch(`/api/users/${userId}`);
+    if (!response.ok) throw new Error(`${response.status}`);
+    return await response.json();
+  } catch (error) {
+    console.error(`Error fetching user ${userId}:`, error);
+    throw error;
+  }
*** End Patch
```

The `@@` marker says "find the line containing `async function fetchUserData`" — location by meaning, not position. Multiple `@@` lines can be nested for disambiguation: `@@ class OrderProcessor @@ def calculate_shipping():`.

GPT-4.1 was trained specifically on this format. It outputs it by default even when prompted to use a different format — a telltale sign of strong pretraining signal.

---

### 5. Apply Model (Cursor's Architecture)

Cursor's approach is qualitatively different: instead of defining a format that the reasoning model must produce, they use _two separate models_.

The **architect model** (GPT-4o, Claude) reasons about what needs to change and produces a rough description or code block — it doesn't need to worry about precise format compliance. The **apply model** (a fine-tuned Llama-3-70B) receives the original file, the conversation context, and the architect's sketch, then produces a complete file rewrite.

Why full rewrite instead of a diff? Cursor's analysis: diffs force the model to think in fewer tokens (compressing context hurts accuracy), models are bad at line-number counting, and with _speculative edits_ (below), rewrites are as fast as diffs.

**Speculative Edits:** Because most of a file is unchanged by any given edit, the original file is a strong prior for what the output will look like. Cursor's serving infrastructure at Fireworks.ai accepts the original file as a `speculation` field and validates output tokens against it in parallel. When the model's output matches the original file (unchanged sections), those tokens are accepted "for free" — the system validates rather than generates. Only the actual edits require full model compute.

Result: ~1000 tokens/sec on a 70B model — a **13× speedup** over vanilla inference — at quality that nearly matches Claude-3-Opus.

---

## The Matching Cascade

The format specification is only half the story. The _matching algorithm_ is what determines production accuracy.

When a model writes a SEARCH block, it reconstructs the target text from memory. This reconstruction is almost never character-perfect:

- It might add/remove a trailing space on one line
- It might normalize two spaces to one
- It might shift indentation by one level
- It might add or remove a trailing newline

Strict exact matching fails all of these. This is why every mature system uses a _cascade_ — trying increasingly permissive strategies until one works.

Aider measured a **9× increase in editing errors** when they disabled their flexible matching. OpenCode implements 9 distinct strategies in sequence before giving up.

### The Four Core Strategies (what this demo implements)

```
Strictest ────────────────────────────────────────────────── Most permissive
    │                                                              │
    ▼                                                              ▼
 Exact         Line-trimmed      Whitespace-          Indentation-
 match         comparison        normalized           flexible
                                 match                match
```

**Strategy 1 — Exact match:** The simplest case. Look for the search string verbatim in the file. If the model reproduced the text perfectly, this succeeds immediately.

**Strategy 2 — Line-trimmed:** Slide a window of the same number of lines over the file. For each window position, compare each line after calling `.trim()` on both. If all trimmed lines match, yield the _original file content_ for that window (preserving actual whitespace). Catches leading/trailing space differences per line.

**Strategy 3 — Whitespace-normalized:** Collapse all whitespace sequences to a single space before comparing. Catches tabs converted to spaces, double spaces, and mixed indentation patterns.

**Strategy 4 — Indentation-flexible:** Strip the minimum common indentation from both the search block and each window, then compare the de-indented versions. Catches the common case where the model produced the right code but with the wrong overall indentation level.

The TypeScript code:

```typescript
// Each Replacer is a generator: given file content and search string,
// it yields candidate substrings of the file that could be the target.
type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

// The orchestrator tries each strategy in order.
// For each yielded candidate, it checks:
//   - Does it exist in the file? (indexOf !== -1)
//   - Does it appear exactly once? (indexOf === lastIndexOf)
// If both pass → apply the replacement.
// If found but not unique → set a flag and keep looking.
export function applyEdit(content: string, oldStr: string, newStr: string): EditResult {
  let foundButNotUnique = false;

  for (const { name, fn } of REPLACERS) {
    for (const candidate of fn(content, oldStr)) {
      const idx = content.indexOf(candidate);
      if (idx === -1) continue;
      const lastIdx = content.lastIndexOf(candidate);
      if (idx !== lastIdx) {
        foundButNotUnique = true;
        continue;
      }
      return {
        content: content.slice(0, idx) + newStr + content.slice(idx + candidate.length),
        strategy: name,
      };
    }
  }

  if (foundButNotUnique)
    throw new Error("Found multiple matches for old_str. Include more context.");
  throw new Error("No match found for old_str. Text must match exactly as it appears in the file.");
}
```

The key insight from OpenCode's source: the uniqueness check runs _inside_ the cascade. A fuzzy strategy might find a match, but if that match appears multiple times in the file, it's rejected and the cascade continues looking for a strategy that yields a _unique_ match. This prevents fuzzy matching from silently replacing the wrong block.

---

## Why Line Numbers Fail

Line numbers feel appealing — they're precise and unambiguous. In practice they're the most fragile anchoring strategy:

**Stale state:** An agent planning five sequential edits commits to line numbers at reasoning time. Edit 1 shifts every subsequent line number by however many lines were added or removed. Edits 2–5 will apply at wrong locations. This is a structural problem with line numbers in any multi-edit session.

**Documented failure rates:** Studies measured > 50% patch failure rates for models like Grok 4 and GLM-4.7 when using line-number-based unified diffs. The Hashline project (per-line CRC32 hashes as anchors) showed an average **+8% improvement across 16 models** just by switching the edit interface, with a **10× improvement for weaker models** (Grok Code Fast: 6.7% → 68.3%).

**Tokenizer interference:** Line numbers are numeric strings. LLMs tokenize them unpredictably and are notoriously bad at arithmetic on them. Off-by-one errors in hunk headers are common enough that any robust patch applier must account for them.

**The convergence:** Both Anthropic's design (text match with `old_str`) and OpenAI's design (`@@` semantic anchors) independently converge on the same conclusion: content-based anchoring beats line-number-based anchoring. The line is found by _what the code says_, not _where it sits_.

---

## The Read-Before-Edit Requirement

Every production system enforces one invariant: **the model must have seen the current file state before editing it.**

Without reading first:

- The model's SEARCH block may reference code that was already modified
- Line numbers are meaningless — the model doesn't know them
- The model can't know current indentation style, variable names, or surrounding context

OpenCode enforces this with a `FileTime.assert()` check that verifies the file hasn't changed since the agent last read it. If it has (because another process modified it, or a code formatter ran), the edit fails with a clear error rather than silently corrupting the file.

This demo enforces it with a simpler `readSet` — a set of file paths that have been read in the current session:

```typescript
if (!readSet.has(args.path)) {
  return JSON.stringify({
    error: `Must call read_file("${args.path}") before editing it.`,
  });
}
```

The error message is designed to be self-correcting: the agent reads what went wrong and calls `read_file` on its next turn.

---

## Uniqueness Enforcement

When `old_str` matches multiple locations, which one did the model intend to change? There's no way to know — and guessing wrong corrupts the file silently, which is worse than failing loudly.

The correct behavior:

```
Error: Found multiple matches for old_str.
Include 2-4 more lines of surrounding context to uniquely identify the target location.
```

Compare Anthropic's approach (simple error string) with Aider's gold-standard error feedback:

```
# 1 SEARCH/REPLACE block failed to match!

## SearchReplaceNoExactMatch: This SEARCH block failed to exactly match lines in src/api.js
<<<<<<< SEARCH
async function fetchUserData(userId) {
  const response = await fetch(`/api/users/${userId}`);
  ...

Did you mean to match some of these actual lines from src/api.js?

async function fetchUserData(userId) {
    const response = await fetch(`/api/users/${userId}`);
    // Some comment here
    ...

The SEARCH section must exactly match an existing block of lines including all
white space, comments, indentation, docstrings, etc.

# The other 2 SEARCH/REPLACE blocks were applied successfully.
Don't re-send them. Just reply with fixed versions of the blocks above that failed.
```

This feedback does four things: explains _what_ failed, shows the _nearest match_ (so the model can see the diff), restates the _matching rules_, and tells the model to _only resend failed blocks_. Each piece directly reduces the chance the model makes the same mistake again. The error message is itself a form of few-shot prompting.

---

## Post-Edit Validation

The edit applied — but did it produce valid code?

OpenCode's LSP feedback loop is the state of the art: after writing the file to disk, the tool queries the Language Server Protocol (LSP) for diagnostics, filters to errors only (severity 1), and injects them directly into the tool's return value:

```typescript
await LSP.touchFile(filePath, true);
const diagnostics = await LSP.diagnostics();
const errors = (diagnostics[filePath] ?? []).filter((d) => d.severity === 1);

if (errors.length > 0) {
  output += `\n\nLSP errors detected, please fix:\n<diagnostics file="${filePath}">\n${errors
    .slice(0, 20)
    .map(LSP.Diagnostic.pretty)
    .join("\n")}\n</diagnostics>`;
}
```

The LLM receives type errors, import failures, and syntax errors in the _same turn_ it applied the edit. This tight feedback loop — edit → validate → see errors → fix — eliminates an entire category of multi-turn correction overhead.

---

## Tradeoffs Summary

| Strategy       | Token cost                     | Reliability               | Model requirement    | Best for                                     |
| -------------- | ------------------------------ | ------------------------- | -------------------- | -------------------------------------------- |
| Whole-file     | High (full file)               | Near 100%                 | Any                  | Small files, apply models, fallback          |
| Search/replace | Low (changes only)             | 70–90%                    | Strong               | Targeted edits, large files                  |
| Unified diff   | Low                            | 70–80%                    | Trained              | Multi-location patches from external sources |
| Semantic patch | Low                            | High (with trained model) | GPT-4.1 specifically | OpenAI ecosystem                             |
| Apply model    | Low (architect) + fast (apply) | 95%+                      | Two-model setup      | Production systems, large files              |

**The JSON lesson:** Structured JSON might seem like the natural format for tool use, but Aider's benchmarks show JSON wrappers consistently hurt code quality (up to 10pp drop). The cognitive overhead of maintaining valid JSON escaping while generating code degrades both correctness and reasoning. Plain text formats with simple conventions (fences, conflict markers, unified diffs) consistently outperform JSON wrappers.

---

## In the Wild: Coding Agent Harnesses

### Claude Code — `str_replace_based_edit_tool`

Claude Code uses a schema-less tool baked into the model's weights. The April 2025 rename from `str_replace_editor` to `str_replace_based_edit_tool` explicitly names the architecture.

The tool has five commands: `view`, `str_replace`, `create`, `insert`, and `undo_edit` (Sonnet 3.7 only — removed in Claude 4). The `str_replace` command requires `old_str` to match exactly once in the file — no fuzzy matching. If it matches zero or multiple times, the tool returns a specific error string and the model retries.

The constraint is simple, but it places the burden of uniqueness entirely on the model. Claude has been fine-tuned to construct good `old_str` values — long enough to be unique, short enough to be efficient. This is a trained behavior, not an algorithmic one.

### OpenCode — 9-Level Cascade

OpenCode (SST) takes the opposite approach: aggressive fuzzy matching through 9 sequential strategies before giving up. The strategies escalate from exact match to `BlockAnchorReplacer` (first/last line anchors + Levenshtein distance on middle lines) to `ContextAwareReplacer` (anchor matching + 50% exact middle-line threshold).

One documented failure mode: `BlockAnchorReplacer` had `SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0`, meaning when only one anchor position existed in the file, it would always accept it regardless of middle-content similarity. This caused wrong-block replacements until a fix was committed in September 2025.

After each edit, OpenCode queries LSP diagnostics and injects any errors into the tool's return value — the LLM sees type errors in the same turn it applied the edit.

### Cline — Order-Invariant Multi-Diff

Cline's breakthrough was diagnosing a specific failure mode: LLMs return multiple SEARCH/REPLACE blocks in the wrong order. The file has changes at lines 10, 45, and 80; the model outputs them as blocks 80, 10, 45. Each block is correct — just in the wrong sequence.

The fix was an _order-invariant_ algorithm: parse all blocks first, sort by their position in the file, then apply in file order. Combined with model-specific delimiter tuning (Anthropic models get `------- SEARCH / +++++++ REPLACE`; Gemini/xAI get `>>>/<<<` blocks), this achieved:

- Claude 3.5 Sonnet: +25% diffEditSuccess
- GPT-4.1: +21%
- Claude Opus 4: +15%

The lesson: matching failures and ordering failures are separate problems requiring separate fixes.

### Cursor — Two-Model + Speculative Decoding

Cursor's Instant Apply pipeline decouples _what to change_ from _how to apply it_. The architect model (GPT-4o, Claude) reasons in natural language. The apply model (Llama-3-70B, fine-tuned on 80% real Cursor sessions + 20% synthetic data) rewrites the entire file.

The speculative decoding trick exploits a structural property of code edits: most of the file is unchanged. Unchanged sections are essentially free — the inference server validates the original file as speculative tokens rather than generating new ones. Only the actual edits require full forward passes.

Quality: the fine-tuned 70B nearly matches Claude-3-Opus-diff and outperforms GPT-4-Turbo and GPT-4o on their internal benchmark (~450 full-file edits under 400 lines).

### OpenAI Codex — V4A Semantic Patch

Codex uses context anchors (`@@`) instead of line numbers: `@@ class OrderProcessor @@ def calculate_shipping():` tells the patch applier to find the `calculate_shipping` method inside `OrderProcessor`. Multiple `@@` lines can nest for precision.

GPT-4.1 was specifically trained on this format — it outputs V4A by default even when prompted to use unified diff, which is the clearest possible evidence of training signal.

Known gotcha: the system prompt documentation uses underscore delimiters (`**_`), but the Rust parser requires asterisk delimiters (`***`). Models trained on the prompt generate patches the parser rejects. This kind of format inconsistency between what the model learns and what the parser expects is a recurring anti-pattern.

### Windsurf Cascade — `{{ ... }}` Placeholder Format

Windsurf's Cascade uses a proprietary format that doesn't appear in any other harness: `{{ ... }}` as a placeholder for unchanged code between edited sections.

```
def process_order(order_id):
    {{ ... }}
    status = "completed"
    {{ ... }}

def calculate_total(items):
    {{ ... }}
    return sum(item.price for item in items) * 1.1
```

The model instruction: "NEVER output an entire file, this is very expensive." The apply algorithm fills in the `{{ ... }}` placeholders from the original file. This is a middle ground between whole-file (expensive) and search/replace (requires exact text match): the model only outputs what changed, but uses a semantic placeholder instead of repeating the original text.

---

## Running the Demo

```bash
pnpm dev:file-edit-strategies
```

The agent manages an in-memory restaurant menu file. Each `edit_file` call goes through the cascade matcher, and the console shows which strategy succeeded:

```
  🔧 Tool call: edit_file
     Args: { "path": "menu.ts", "old_str": "{ name: \"Tiramisu\", price: 8.00...", ... }
     Result: Edit applied successfully. (cascade strategy: exact)
```

Use `/menu` to see the current file state after edits.

**What to observe:**

- **Read-before-edit:** Try `edit_file` on a fresh session without `read_file` first — the agent must call `read_file` first
- **Uniqueness enforcement:** Ask the agent to "change the description of the first item in starters to mention garlic" — if the model crafts an `old_str` using only `description: "Toasted bread` it should work fine, but if it tries something as short as `description: "` the uniqueness check will reject it with "Found multiple matches"
- **Cascade in action:** The strategy logged in the console reveals whether exact match or a fallback was needed

---

## Key Takeaways

1. **Format is a first-class performance variable.** The same model can swing from 20% to 61% accuracy just by changing edit format. Format selection is not cosmetic.

2. **The matching algorithm is as important as the format spec.** Aider's 9× error increase without flexible matching. The format tells the model what to produce; the cascade makes it work at production accuracy.

3. **Avoid line numbers.** Every production harness has moved away from line-number-based edits. Content anchoring (text match, semantic anchors) is more stable across sessions.

4. **Error feedback is a first-class feature.** Aider's detailed error messages — showing nearest match, restating rules, instructing selective retry — are themselves a form of few-shot prompting. Simple error strings require more retry turns.

5. **The format/model pairing matters.** Gemini needs `diff-fenced`. GPT-4.1 has strong V4A pretraining. GPT-4 Turbo-era models needed udiff to prevent lazy coding. There is no universally best format — match the format to the model.

6. **Two-model architectures eliminate the format compliance problem entirely.** When format compliance and problem-solving compete for attention in the same LLM call, both suffer. Separating them — even at extra cost — often improves total accuracy.

---

## Sources & Further Reading

- [Aider — Edit Formats](https://aider.chat/docs/more/edit-formats.html) — the most comprehensive edit format zoo, with benchmarks per model family
- [Aider — Unified Diffs Make GPT-4 Turbo 3× Less Lazy](https://aider.chat/2023/12/21/unified-diffs.html) — the 20% → 61% benchmark result and the four design principles
- [Aider — Architect Mode](https://aider.chat/2024/09/26/architect.html) — full benchmark table for every architect/editor model pairing
- [Cursor — Instant Apply](https://cursor.com/blog/instant-apply) — two-model architecture, speculative edits, why full rewrites beat diffs
- [Fireworks AI — Cursor Fast Apply](https://fireworks.ai/blog/cursor) — the inference infrastructure behind 1000 tok/s on Llama-3-70B
- [Cline — Improving Diff Edits by 10%](https://cline.bot/blog/improving-diff-edits-by-10) — order-invariant multi-diff application with model-specific delimiters
- [OpenCode source — edit.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/edit.ts) — the 9-level cascade matcher in TypeScript
- [Fabian Hertwig — Code Surgery: How AI Assistants Make Precise Edits](https://fabianhertwig.com/blog/coding-assistants-file-edits/) — cross-harness comparison (Codex, Aider, OpenHands, RooCode, Cursor)
- [Anthropic — Text Editor Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool) — `str_replace_based_edit_tool` full spec and command reference
- [Diff-XYZ Benchmark (arxiv:2510.12487)](https://arxiv.org/html/2510.12487) — search/replace vs unified diff accuracy per model family
- [OpenAI Codex — apply_patch format](https://github.com/openai/codex/blob/main/codex-rs/apply-patch/apply_patch_tool_instructions.md) — the V4A patch format specification
