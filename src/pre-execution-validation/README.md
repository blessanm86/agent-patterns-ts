# Edit in the Shadows: How AI Agents Test Code Before You See It

[Agent Patterns — TypeScript](../../README.md)

---

When an AI agent edits your code, you typically see the edit, run a build, discover it broke three call sites, and ask the agent to fix them. Each correction round costs tokens, time, and patience. What if the agent could catch those errors _before_ you ever saw them?

That's pre-execution validation. Instead of applying edits directly to your workspace, the agent applies them to an isolated **shadow copy** first. Validators run against the shadow — linters, type checkers, test suites — and only if everything passes does the edit propagate to your real files. The user never sees the broken intermediate state.

## The Core Insight

The same code quality tools that developers already use — TypeScript's `tsc`, ESLint, pytest, `go vet` — become an automated feedback loop for the agent. The agent writes code, the tools find problems, the agent fixes them, and this repeats until the output is clean. The user only sees the final, validated result.

```
Agent proposes edit
        │
        ▼
┌─────────────────────┐
│   Shadow Workspace   │  ← Isolated copy of the project
│                     │
│  1. Apply edit      │
│  2. Run validators  │
│  3. Collect errors  │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    │           │
  Valid?     Errors?
    │           │
    ▼           ▼
 Promote    Feed errors back
 to real    to agent → retry
 workspace
```

This is the validation loop that separates "90% working code" from "100% working code."

## Four Validation Philosophies

Research across the industry reveals four distinct approaches to the same problem:

### 1. Shadow Workspace (Cursor)

Cursor's approach is the most architecturally novel. A **hidden Electron window** runs the same VS Code workspace, invisible to the user. When the AI proposes an edit:

1. The edit is sent via **gRPC/protobuf** from the visible window to the hidden one
2. The edit is applied to the shadow window's in-memory `TextModel`
3. The **Language Server Protocol (LSP)** processes the change and generates diagnostics
4. Diagnostics are sent back to the AI for iteration
5. The cycle repeats until the LSP reports zero errors

The hidden window auto-kills after 15 minutes of inactivity. Multiple AI branches time-slice through a single shadow window — A1→B1→A2→B2 — resetting folder state between each. The insight: "AIs can be paused an indefinite amount of time without even noticing."

**Cost:** ~2x memory per shadow window. Initial language server warmup ~2 seconds. Rust is unsupported (rust-analyzer requires disk writes). The whole thing was a 1-week, 1-person project.

### 2. Sandbox Execution (OpenAI Codex, Amazon Q)

Instead of static analysis, these run the code in an isolated container:

**OpenAI Codex** trains with reinforcement learning specifically to "iteratively run tests until receiving a passing result." Each task runs in a cloud sandbox with network disabled, pre-installed dependencies, and `AGENTS.md` files that tell the agent which lint and test commands to run.

**Amazon Q Developer** uses Devfiles (schema 2.2.0) that define `install`, `build`, and `test` commands. The agent runs in a Docker sandbox (2 vCPUs, 4 GB memory, no external network). If tests fail, the agent iterates — up to 3 cycles before presenting results. SWE-bench Verified scores jumped from 25.6% to 38.8% after adding this validation loop.

### 3. Hook-Based Interception (Claude Code, Aider)

Rather than a separate workspace, validation hooks intercept the agent's actions in-place:

**Claude Code** provides lifecycle hooks: `PreToolUse` fires before any tool call (can block with exit code 2), `PostToolUse` fires after (auto-formats with Prettier). Three hook types with increasing intelligence — command hooks (deterministic shell scripts), prompt hooks (single-turn LLM judgment), and agent hooks (multi-turn subagent with tool access). Key insight from Anthropic: "An instruction in your CLAUDE.md file is a suggestion that might get de-prioritized, whereas hooks guarantee execution."

**Aider** runs external linters after every edit. Built-in support for most languages via tree-sitter. If lint errors are found, the output is fed back to the LLM. Configurable with `--lint-cmd` and `--test-cmd`.

**OpenCode** embeds LSP diagnostics directly in the edit tool's return value — the agent never sees "edit succeeded" without also seeing any problems. A 150ms debounce waits for semantic analysis after syntax checking.

**Windsurf (Cascade)** takes a similar approach — auto-lint-fix runs after every AI edit, catching syntax and style issues before the user reviews the diff. Like Aider, it uses external linters, but the fix step is automatic rather than requiring another LLM round-trip.

### 4. Generate-and-Filter (AlphaCode 2, Gemini)

A fundamentally different philosophy: instead of iterating on a single edit, generate _many_ candidates and filter down to the best one.

**AlphaCode 2** (DeepMind) generates up to **1 million code samples** per problem, then applies a multi-stage filter pipeline: static analysis removes non-compiling code, test execution removes incorrect solutions, clustering groups semantically similar survivors, and a scoring model picks the best representative from each cluster. The validation isn't a feedback loop — it's a funnel. The LLM never sees its errors; bad outputs are simply discarded.

**Gemini's code execution** takes a lighter version of this approach: the model generates code, executes it in a sandbox, and if the output is wrong, regenerates — up to 5 attempts. Unlike AlphaCode 2's massive parallelism, Gemini uses sequential retry, but the principle is the same: generate, test, keep or discard.

**DeepSeek** explores a dual-model variant with a separate **verifier model** that scores candidate solutions. Their "Thinking in Tool-Use" pattern interleaves reasoning and execution — the model runs code mid-thought to validate intermediate steps before committing to a solution path.

This philosophy trades compute for quality. It works best when generation is cheap relative to validation (competitive programming, batch code generation) and worst when each generation is expensive or when the user expects low latency.

## The Implementation: Shadow-Validated Recipe Edits

Our demo builds an agent that manages recipe JSON files in a workspace. When the agent edits a recipe, the edit goes through the full shadow workspace lifecycle:

### The Shadow Workspace Provider (`shadow.ts`)

```typescript
// The complete lifecycle for a single edit:
//   1. Clone workspace to shadow
//   2. Apply edit to shadow
//   3. Validate the shadow
//   4. If valid → promote to real workspace
//   5. If invalid → discard shadow, return diagnostics

export function shadowEdit(
  workspace: Workspace,
  filename: string,
  content: string,
): ShadowEditResult {
  const shadow = createShadow(workspace); // 1. Clone
  applyEditToShadow(shadow, filename, content); // 2. Apply
  const result = validateFile(filename, content); // 3. Validate

  if (result.valid) {
    promote(shadow, workspace); // 4. Promote
    return { success: true, promoted: true, diagnostics: [], shadowId: shadow.id };
  }

  // 5. Discard — return diagnostics for self-correction
  return { success: false, promoted: false, diagnostics: result.diagnostics, shadowId: shadow.id };
}
```

The workspace is an in-memory filesystem (`Map<string, string>`) for portability. In production, this would be a temp directory, a hidden editor window, or a Docker container.

### Three-Layer Validation

Validation mirrors what real tools do — progressively deeper checks:

```typescript
// Layer 1: JSON syntax (like a compiler checking for parse errors)
let parsed: unknown;
try {
  parsed = JSON.parse(content);
} catch (e) {
  return { valid: false, diagnostics: [{ layer: "syntax", ... }] };
}

// Layer 2: Schema validation via Zod (like TypeScript type checking)
const result = RecipeSchema.safeParse(parsed);
if (!result.success) {
  return { valid: false, diagnostics: result.error.issues.map(...) };
}

// Layer 3: Semantic validation (like integration tests)
// Calorie count must roughly match macros (protein*4 + carbs*4 + fat*9)
const estimatedCalories =
  recipe.nutrition.proteinGrams * 4 +
  recipe.nutrition.carbsGrams * 4 +
  recipe.nutrition.fatGrams * 9;
if (Math.abs(estimatedCalories - declaredCalories) / declaredCalories > 0.4) {
  diagnostics.push({ layer: "semantic", message: "Calorie mismatch..." });
}
```

**Layer 1 (Syntax)** catches malformed JSON — equivalent to a compiler failing to parse. **Layer 2 (Schema)** catches structural violations — wrong types, missing fields, invalid enum values — equivalent to type checking. **Layer 3 (Semantic)** catches cross-field inconsistencies that no schema can express — calorie/macro mismatches, duplicate ingredients, unreasonable prep times — equivalent to integration tests.

### Transparent Validation in the Edit Tool

The key difference from [Self-Validation Tool](../self-validation/README.md): validation is **built into the edit tool**, not a separate tool the agent must remember to call. The agent calls `edit_recipe` and gets back either success or diagnostics:

```typescript
// In tools.ts — the agent just calls edit_recipe
case "edit_recipe": {
  if (mode === "shadow") {
    const result = editRecipeShadow(workspace, args);
    // Returns either { status: "promoted" } or { status: "rejected", diagnostics: [...] }
    return result;
  }
  // Direct mode: apply immediately, no validation
  workspace.files.set(args.filename, args.content);
  return { status: "applied" };
}
```

When the edit is rejected, the agent sees structured diagnostics and self-corrects:

```json
{
  "status": "rejected",
  "message": "Edit failed validation in shadow-3. Fix these errors and try again:",
  "diagnostics": [
    {
      "layer": "semantic",
      "location": "curry.json:nutrition",
      "error": "Calorie mismatch: declared 200 cal but macros suggest ~480 cal (140% drift)"
    }
  ]
}
```

### A/B Comparison

Run in shadow mode (default) or direct mode to see the difference:

```bash
pnpm dev:shadow-validation          # Shadow: clone → validate → promote/discard
pnpm dev:shadow-validation:direct   # Direct: apply immediately, no validation
```

## When Shadow Validation Is Worth It (And When It's Overkill)

**Worth it when:**

- The agent makes multi-file edits where one change can break another
- Type errors are common and cheap to catch (TypeScript, Go, Rust)
- Users expect polished output with zero visible errors
- The validation cost (latency, memory) is small relative to the error correction cost

**Overkill when:**

- Edits are simple and low-risk (formatting, comments, documentation)
- The validator is slow (full test suite taking minutes)
- The agent already has high accuracy for the task
- Interactive mode where the user _wants_ to see intermediate states

**The cost tradeoff:** Cursor's shadow workspace adds ~2x memory and ~2 seconds of language server warmup. Amazon Q's sandbox is 2 vCPUs and 4 GB per task. The question is always: does the cost of validation outweigh the cost of the user seeing errors and asking for fixes?

Academic research gives a concrete answer: **diminishing returns after 2-3 iterations**. A study using Bandit and Pylint as feedback found security issues dropped from 40% to 13%, but improvement probability fell below 10% after iteration 10. FeedbackEval found repair accuracy stabilized after 2-3 rounds. The sweet spot is 2-3 validation cycles — enough to catch most errors without burning through tokens.

## In the Wild: Coding Agent Harnesses

Pre-execution validation is one of the highest-impact patterns in production coding agents. Every major harness implements some version of it.

**Cursor** pioneered the shadow workspace concept — a hidden Electron window with full LSP integration, communicating via gRPC/protobuf. The AI iterates with the language server until diagnostics are clean, then presents the diff. This is the purest implementation of "validate before the user sees it." Limitations: Rust unsupported (rust-analyzer needs disk writes), ~2x memory overhead, and running actual tests/builds in the shadow remains unsolved.

**Claude Code** takes the hooks approach — `PreToolUse` hooks can block dangerous tool calls, `PostToolUse` hooks auto-format after every edit, and agent-based `Stop` hooks can run full test suites before allowing the agent to finish. Since version 2.0.74, native LSP integration pushes diagnostics after every file edit — Claude sees type errors and missing imports immediately and fixes them in the same turn. The example flow: Claude edits a function signature, LSP reports 3 broken call sites, Claude fixes all three before the user sees any error.

**OpenCode** embeds LSP diagnostics _inside_ the edit tool's return value. After every file modification, it calls `LSP.touchFile()` followed by `LSP.diagnostics()` with a 150ms debounce. The agent receives structured diagnostic objects (severity, line range, message) as part of the tool response — not as a separate step. This is the most tightly integrated approach: validation is invisible infrastructure, not a tool the agent must remember to call.

**Aider** runs external linters after every edit with auto-lint enabled by default. If errors are found, the output goes straight back to the LLM. The architectural difference from OpenCode: Aider validates _after commit_ (creating potentially fragmented commit histories), while OpenCode validates _before commit_. Practitioners report Aider sometimes creates 9 commits for a single fix due to this post-commit validation approach.

**Amazon Q Developer** uses Docker sandboxes with Devfile-controlled validation. The agent runs build and test commands in an isolated container (2 vCPUs, 4 GB memory, no external network), iterates on failures, and only presents results after validation passes. SWE-bench scores improved 51% after adding this real-time execution loop.

**GitHub Copilot Coding Agent** runs three-layer security validation before creating PRs: CodeQL for vulnerability scanning, GitHub Advisory Database for dependency checking, and secret scanning for leaked credentials. If issues are found, Copilot attempts self-repair before finishing the PR.

**Windsurf (Cascade)** runs auto-lint-fix after every AI edit. Similar to Aider's approach but with automatic fix application — the linter output is both shown to the model and auto-corrected where possible, reducing the number of LLM round-trips needed.

Beyond individual harnesses, **Sonar's AC/DC (Agent-Centric Development Cycle)** framework provides a useful mental model for how validation loops compose. The framework defines two nested loops: an **inner loop** (Guide→Generate→Verify→Solve) where the agent writes and validates code with fast feedback from linters and type checkers, and an **outer loop** where broader quality gates (security scans, integration tests, code review) validate the accumulated changes. Factory.ai extends this thinking with their "linters write the law" framework — categorizing lint rules into 7 types (correctness, security, performance, style, complexity, deprecated APIs, framework-specific) and arguing that each category acts as an executable specification that agents can iterate against without human intervention.

## Key Takeaways

1. **Validate before you ship** — the core insight shared by all four approaches. Whether it's a shadow workspace, a sandbox container, a lifecycle hook, or a generate-and-filter pipeline, the goal is the same: catch errors before the user sees them.

2. **Make validation transparent** — the agent shouldn't need to remember to call a validator. Embed validation in the edit tool itself (like OpenCode's inline diagnostics) or intercept with hooks (like Claude Code's PostToolUse). The best validation is invisible.

3. **Three layers of depth** — syntax checking (parse errors) → schema validation (type errors) → semantic rules (integration tests). Each layer catches what the previous one can't. Real harnesses use the same progression: compiler → linter → test suite.

4. **Diminishing returns after 2-3 iterations** — academic research consistently shows repair accuracy stabilizes after a few rounds. Don't loop forever; set a cap and present what you have.

5. **The cost question is real** — shadow workspaces cost memory (Cursor: ~2x), sandboxes cost compute (Amazon Q: 2 vCPU + 4 GB), and every validation cycle costs latency. The pattern is worth it when validation is cheap relative to the user seeing errors.

6. **Shadow vs. in-place is a spectrum** — Cursor uses a full hidden editor, OpenCode uses inline diagnostics, Aider uses post-edit linting, AlphaCode 2 generates millions of candidates and filters. The right choice depends on how much isolation you need, how fast your validators are, and whether you can afford parallel generation.

## Sources & Further Reading

- [Cursor — Shadow Workspace](https://cursor.com/blog/shadow-workspace) — the canonical shadow workspace implementation with LSP validation
- [AWS — Reinventing Amazon Q Developer Agent](https://aws.amazon.com/blogs/devops/reinventing-the-amazon-q-developer-agent-for-software-development/) — candidate generation + sandbox testing
- [AWS — Enhancing Code Generation with Real-Time Execution](https://aws.amazon.com/blogs/devops/enhancing-code-generation-with-real-time-execution-in-amazon-q-developer/) — Devfile-controlled validation loop
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide) — PreToolUse/PostToolUse lifecycle hooks
- [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) — evaluator-optimizer pattern
- [OpenCode LSP Docs](https://opencode.ai/docs/lsp/) — inline diagnostics in tool responses
- [Aider — Linting & Testing](https://aider.chat/docs/usage/lint-test.html) — auto-lint/auto-test feedback loop
- [Factory.ai — Using Linters to Direct Agents](https://factory.ai/news/using-linters-to-direct-agents) — linters as executable specifications
- [Static Analysis as a Feedback Loop](https://arxiv.org/html/2508.14419v1) — measured improvements: security issues 40%→13%, readability 84%→11%
- [FeedbackEval Benchmark](https://arxiv.org/html/2504.06939v1) — structured feedback yields highest repair rates, diminishing returns after 2-3 rounds
- [Sonar — AC/DC Framework](https://securityboulevard.com/2026/03/the-future-is-ac-dc-the-agent-centric-development-cycle/) — Guide→Generate→Verify→Solve with sandbox inner/outer loops
- [OpenAI — Codex Cloud Environments](https://developers.openai.com/codex/cloud/environments/) — sandboxed execution with RL-trained test iteration
- [GitHub — Copilot Coding Agent Security Validation](https://github.blog/changelog/2025-10-28-copilot-coding-agent-now-automatically-validates-code-security-and-quality/) — CodeQL + advisory DB + secret scanning
- [Addy Osmani — LLM Coding Workflow 2026](https://addyosmani.com/blog/ai-coding-workflow/) — practitioner validation layers
- [OpenCode Deep Dive](https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/) — LSP diagnostics after every file edit
- [AlphaCode 2 Technical Report](https://storage.googleapis.com/deepmind-media/AlphaCode2/AlphaCode2_Tech_Report.pdf) — generate 1M samples, filter via static analysis + test execution + clustering
- [Gemini Code Execution](https://ai.google.dev/gemini-api/docs/code-execution) — sandbox execution with up to 5 regeneration attempts
- [DeepSeek-R1 Technical Report](https://arxiv.org/abs/2501.12948) — verifier-generator dual model, interleaved reasoning and execution
