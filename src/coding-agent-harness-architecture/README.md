# Inside the Black Box: How Coding Agents Actually Work

---

🎧 **Audio Overview** — [Listen](https://blessanm86.github.io/agent-patterns-ts/src/coding-agent-harness-architecture/coding-agent-harness-architecture-podcast.mp3) · 50:32

---

You've built a ReAct loop, wired up tools, managed context windows, streamed tokens, delegated to sub-agents, and added guardrails. You've studied frameworks, SDKs, and orchestration libraries. But there's one layer of the agent stack you use every day that still feels like a black box: the **coding agent harness**.

Claude Code, Aider, OpenCode — these aren't toy demos or framework examples. They're production systems that combine _dozens_ of the patterns you've built in this repo into a single product. This guide cracks them open. By the end, you'll look at your coding agent and think: "oh, _that's_ what it's doing when it pauses to compact context" or "so _that's_ why it spawns a sub-agent for file exploration."

---

## What Is a Harness?

The [Agent Framework Landscape](../agent-framework-landscape/README.md) guide introduced a 4-layer stack. Harnesses sit at the very top:

```
┌─────────────────────────────────────────────────┐
│              HARNESSES  ← you are here           │
│  Claude Code, Aider, OpenCode, Cursor, Devin    │
├─────────────────────────────────────────────────┤
│                 FRAMEWORKS                       │
│  LangGraph, CrewAI, Vercel AI SDK, Mastra       │
├─────────────────────────────────────────────────┤
│                 PROTOCOLS                        │
│  MCP (tool integration), A2A (agent-to-agent)   │
├─────────────────────────────────────────────────┤
│                 MODEL APIs                       │
│  Anthropic, OpenAI, Google, Ollama              │
└─────────────────────────────────────────────────┘
```

A framework gives you building blocks. A harness gives you a finished operating environment. Phil Schmid's analogy captures it precisely:

| Computer Systems | Agent Systems                                           |
| ---------------- | ------------------------------------------------------- |
| CPU              | LLM (raw cognitive capacity)                            |
| RAM              | Context window (volatile working memory)                |
| Disk             | Database/files (persistent storage)                     |
| Operating System | **Agent harness** (resource management, lifecycle, I/O) |
| Application      | Agent (user-specific logic)                             |

The harness manages everything the model can't manage for itself: which files to read, when to compact context, how to apply edits safely, when to ask for permission, how to persist knowledge across sessions. It's the difference between a model that can reason about code and a tool that can _change_ code reliably.

**A harness is not a framework you compose from.** It's an opinionated, batteries-included runtime that makes dozens of architectural decisions for you — edit format, context strategy, permission model, extension system — so you can focus on describing what you want done.

---

## The Three Harnesses

This guide deep-dives three open-source CLI harnesses. Each makes fundamentally different architectural bets:

| Dimension            | Claude Code                    | OpenCode                          | Aider                                |
| -------------------- | ------------------------------ | --------------------------------- | ------------------------------------ |
| **Philosophy**       | Model as CEO                   | Client-server platform            | Git-native pair programmer           |
| **Provider**         | Anthropic only                 | 75+ (via Vercel AI SDK)           | Any provider                         |
| **Agent loop**       | Single-threaded master loop    | Single-threaded with event bus    | Single interaction loop              |
| **Sub-agents**       | Yes (depth-1 limit)            | Yes (session-isolated)            | No                                   |
| **Edit strategy**    | Exact string replacement       | String replace + patch + write    | 5+ pluggable formats                 |
| **Context strategy** | Auto-compaction + CLAUDE.md    | Token tracking + compaction + LSP | Repo map (tree-sitter + PageRank)    |
| **Code search**      | ripgrep + glob (no embeddings) | ripgrep + glob + LSP              | Tree-sitter AST + PageRank           |
| **Extension model**  | Hooks + Skills + MCP + Plugins | Plugins + MCP + custom tools      | Pluggable edit formats               |
| **Git integration**  | Optional (user-driven)         | Git snapshots for rollback        | First-class (auto-commit everything) |

Why these three? They represent three distinct points in the design space. Claude Code bets on model intelligence and a thin loop. Aider bets on deterministic code analysis and human-in-the-loop. OpenCode bets on platform architecture and LSP integration. Studying where they agree reveals the essential patterns; studying where they disagree reveals the real tradeoffs.

---

## Claude Code: The Model-as-CEO Architecture

Claude Code's core thesis: **the model is smart enough to drive.** Give it good tools, a simple loop, and get out of the way. The harness is deliberately thin — Anthropic reports the core loop is roughly 50 lines of code, with ~90% of the codebase written by Claude itself.

### The Agent Loop

Claude Code runs a **single-threaded master loop** — internally referred to as **"nO"** — that implements a textbook ReAct pattern:

```
User input arrives
  → Model analyzes and decides on actions
  → If tool calls: execute them, feed results back, loop
  → If plain text response: break, return to user
  → Repeat
```

The loop terminates naturally when the model generates a text response with no tool invocations. Three conceptual phases — **gather context**, **take action**, **verify results** — blend together rather than executing as discrete stages. A bug fix cycles through all three repeatedly, with Claude course-correcting based on what each step reveals.

This is conceptually identical to the [ReAct Loop](../react/README.md) you built in this repo. The difference is everything surrounding it.

**Real-time steering** is a critical production feature. An asynchronous dual-buffer queue (internally "h2A") lets users inject corrections while Claude actively works — you can press Escape, type new instructions, and Claude incorporates them without losing context or progress. This addresses the biggest gap in autonomous systems: controllability.

### The Tool System

Claude Code ships **18 built-in tools** organized into functional categories:

| Category             | Tools                                                        | Purpose                                                                 |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **File ops**         | Read, Edit, Write, NotebookEdit                              | Read files, exact string replacement, full file writes, notebook cells  |
| **Search**           | Glob, Grep, LSP                                              | Pattern matching, content search (ripgrep), type errors and definitions |
| **Execution**        | Bash, Computer                                               | Shell commands with risk classification, Chrome automation              |
| **Orchestration**    | Agent, TaskCreate, EnterPlanMode, ExitPlanMode, Skill, Sleep | Sub-agent spawning, task tracking, planning workflow, skill invocation  |
| **User interaction** | AskUserQuestion, EnterWorktree                               | Interactive questioning, git worktree management                        |

A notable design choice: **no embeddings, no vector database.** Claude Code relies entirely on ripgrep and glob for code search, leveraging the model's ability to craft effective regex patterns. This avoids indexing overhead, stale index problems, and the complexity of maintaining an embedding pipeline — at the cost of depending on the model's query formulation skills.

Every tool follows the same [tool pattern](../react/README.md) from this repo: a JSON schema definition (sent to the model) and a private implementation (the model never sees). The schema descriptions are carefully engineered to guide the model toward correct usage — [tool description engineering](../tool-descriptions/README.md) at production scale.

### Sub-Agent Architecture

Claude Code supports three built-in sub-agent types:

| Agent               | Model               | Tools     | Purpose                              |
| ------------------- | ------------------- | --------- | ------------------------------------ |
| **Explore**         | Haiku (fast, cheap) | Read-only | Codebase exploration, file discovery |
| **Plan**            | Inherits parent     | Read-only | Research during plan mode            |
| **General-purpose** | Inherits parent     | All tools | Complex multi-step tasks             |

The critical architectural constraint: **sub-agents cannot spawn other sub-agents** (depth limit of 1). This prevents recursive agent explosion — a real failure mode in multi-agent systems. When a sub-agent needs further delegation, the main conversation must orchestrate it.

Each sub-agent runs in **complete context isolation**: its own context window, a custom system prompt (not the full Claude Code system prompt), specific tool access, and independent permissions. When complete, it returns a summary to the main conversation. The intermediate work stays in the sub-agent's context, keeping the main conversation clean.

This maps directly to the [Sub-Agent Delegation](../sub-agent-delegation/README.md) pattern — but with a production-critical addition: sub-agents are **resumable**. Each invocation gets an agent ID, and the main agent can resume it to continue with full conversation history retained. Transcripts persist to disk.

Custom sub-agents are defined as Markdown files with YAML frontmatter:

```markdown
---
name: code-reviewer
description: Expert code review specialist
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a senior code reviewer. Focus on...
```

### Context Management

Claude Code's context strategy combines four mechanisms:

**1. Auto-compaction** triggers at approximately 92-95% context utilization. First pass: clear older tool outputs. Second pass: summarize the conversation if needed. CLAUDE.md fully survives compaction — it's re-read from disk and re-injected fresh. Only conversational instructions can be lost. This is [Context Window Management](../context-management/README.md) in production.

**2. CLAUDE.md** is the primary persistent context mechanism — a hierarchy of markdown files loaded at session start:

| Level   | File                                                | Scope                              |
| ------- | --------------------------------------------------- | ---------------------------------- |
| Managed | `/Library/Application Support/ClaudeCode/CLAUDE.md` | Org-wide, cannot be excluded       |
| Project | `./CLAUDE.md`                                       | Team-shared, in git                |
| User    | `~/.claude/CLAUDE.md`                               | Personal, all projects             |
| Local   | `./CLAUDE.local.md`                                 | Personal, this project, gitignored |

Subdirectory CLAUDE.md files load on-demand when Claude reads files in those directories. This is [Ambient Context](../ambient-context/README.md) — context that arrives based on what the agent is working on, not what was explicitly configured.

**3. Auto memory (MEMORY.md)** — notes Claude writes itself, stored at `~/.claude/projects/<project>/memory/`. First 200 lines loaded each session. Claude decides what's worth remembering: build commands, debugging insights, patterns. This is [Persistent Cross-Session Memory](../persistent-memory/README.md).

**4. System prompt architecture** — the system prompt is not a single string but **110+ conditionally-loaded segments** including tool descriptions, sub-agent prompts, system reminders, data references, and slash command definitions. TODO list state is injected after tool uses as system reminders, preventing the model from losing track during long conversations — the [Agent TODO Lists](../todo-lists/README.md) pattern.

### Extension Model

Claude Code has six extension types, each with distinct context cost profiles:

| Extension      | Context Cost                          | When It Loads  | Purpose                               |
| -------------- | ------------------------------------- | -------------- | ------------------------------------- |
| **CLAUDE.md**  | Every request                         | Session start  | Always-on project conventions         |
| **Skills**     | Low (descriptions only until invoked) | On-demand      | Reusable knowledge and workflows      |
| **MCP**        | Every request (tool definitions)      | Session start  | External service connections          |
| **Sub-agents** | Isolated                              | When spawned   | Task delegation                       |
| **Hooks**      | Zero                                  | On trigger     | Deterministic automation              |
| **Plugins**    | Varies                                | When installed | Bundled skills + hooks + agents + MCP |

**Hooks** are the zero-context-cost extension point. They fire at 16+ lifecycle events (SessionStart, PreToolUse, PostToolUse, SubagentStart, PreCompact, and more) and can be shell commands, HTTP endpoints, or LLM prompts. PreToolUse hooks can block tool calls — making them the enforcement layer for the [Human-in-the-Loop](../human-in-the-loop/README.md) pattern.

The layered design means users can optimize their context budget. Always-on conventions go in CLAUDE.md. Rarely-needed knowledge goes in Skills (loaded on demand). Deterministic automation goes in Hooks (zero context cost). This is the [On-Demand Skill Injection](../skill-injection/README.md) pattern and [Agent Middleware](../middleware-pipeline/README.md) pattern working together at scale.

### Edit Strategy

Claude Code uses **exact string replacement** as its primary edit mechanism. The Edit tool takes `old_string` and `new_string` parameters, where `old_string` must be unique in the file. This produces minimal, surgical, reviewable diffs.

Before every edit, file contents are checkpointed. Users can press Escape twice to rewind to a previous state — a safety net separate from git.

This is the simplest possible edit strategy. It works because Claude can craft unique match strings reliably. The tradeoff: it can fail if the string appears multiple times, requiring the model to include more surrounding context for uniqueness.

---

## OpenCode: The Platform Architecture

OpenCode takes a fundamentally different approach: **the harness is a platform, not a CLI tool.** Its client-server architecture separates the agent backend from the user interface, enabling multiple clients (TUI, desktop app, VS Code extension, web) to connect to the same agent.

### Architecture: Client-Server Split

```
opencode command
  → Bun launches HTTP server (Hono) on localhost:port
  → Bun spawns TUI process (SolidJS-based terminal app)
  → TUI connects via localhost:port
  → User input flows: TUI → HTTP → Session.prompt()
  → Results streamed back via SSE
```

**Backend**: Bun runtime, Hono HTTP framework, SQLite (via Drizzle ORM) for session/message persistence, CORS middleware, basic auth.

**Frontend**: Originally a Go-based Bubble Tea TUI, now a SolidJS-based terminal application using `@opentui/solid`. Runs as a separate process, communicates via REST API and SSE.

This architecture is **interface-agnostic** — the same backend serves TUI, desktop app (Tauri + Solid.js), VS Code extension, and web interface. Any HTTP client can interact with OpenCode. The monorepo contains 20+ packages organized with Bun workspaces and Turbo.

This is a bet that coding agents will become platforms, not tools. Claude Code and Aider are single-process CLI tools that do one thing well. OpenCode is infrastructure that multiple interfaces can build on.

### LSP Integration: The Diagnostic Feedback Loop

OpenCode's most distinctive feature is **deep LSP integration**. After every file edit, the LLM gets compiler/linter feedback automatically:

```
File Edit (via edit/write tool)
  → LSP Client sends textDocument/didChange to server
  → Server returns textDocument/publishDiagnostics
  → Client stores diagnostics, debounces 150ms
  → Diagnostics formatted and appended in <diagnostics> tags
  → LLM receives feedback in next context window
```

OpenCode ships with **30+ pre-configured LSP server definitions** (TypeScript, Python, Go, Rust, C/C++, Ruby, PHP, Java, Kotlin, Haskell, Elixir, Vue, Svelte, Astro, Zig, Dart, Gleam, Nix, Terraform, YAML, Bash) with auto-installation support.

Why this matters: it creates a **grounding feedback loop**. The LLM makes an edit, immediately gets type errors, and can self-correct before moving on. This prevents error cascading — a common failure mode in coding agents that edit files without verification. It's the [Self-Validation Tool](../self-validation/README.md) pattern baked into the infrastructure.

Beyond diagnostics, LSP provides experimental code intelligence tools: hover (type info), definition, references, implementation, workspace symbol search, and call hierarchy. These give the model richer code understanding than text-based search alone.

**Error handling is pragmatic**: broken LSP servers are marked broken and not retried during the session. 45-second timeout for initialization with zombie process cleanup. 3-second timeout when waiting for diagnostics.

### Event Bus + SSE

A central **Event Bus** provides publish-subscribe messaging across the entire application:

```
Backend operations → Publish events to central bus → Stream via SSE to all clients
                                                   → Clients apply events to local reactive stores
```

30+ typed event categories cover sessions, messages, tools, files, LSP, shell, permissions, and UI. During LLM streaming, fine-grained events (`start-step`, `finish-step`, `tool-call`, `tool-result`, `text-delta`) enable real-time rendering of agent progress in any connected client.

SSE endpoints: `/event` (project-scoped), `/global/event` (cross-instance), `/pty/:ptyID/connect` (WebSocket for terminal). Multiple clients can subscribe to the same directory and receive synchronized events.

This is the [Streaming Responses](../streaming/README.md) pattern extended into an event-driven architecture. The bus is also the foundation for the plugin system — every event is hookable.

### Tool System

OpenCode ships **16+ built-in tools**: `edit`, `write`, `patch`, `read`, `bash`, `grep`, `glob`, `list`, `webfetch`, `websearch`, `lsp` (experimental), `task`, `skill`, `question`, `todowrite`, `todoread`.

The **tool execution pipeline** is the most structured of the three harnesses:

1. **Permission validation** (agent-level permissions)
2. **Pre-execution hooks** (plugins via `tool.execute.before`)
3. **Git snapshot** (`git add . && git writeTree` for rollback)
4. **Execution**
5. **LSP diagnostics** (150ms wait for feedback)
6. **Output truncation** (max 40K tokens)
7. **Post-execution hooks** (plugins via `tool.execute.after`)
8. **Result return** (stream back to agent loop)

This is the [Agent Middleware Pipeline](../middleware-pipeline/README.md) pattern — a chain of pre/post processing around every tool call. The git snapshotting before execution provides rollback without affecting git history.

The **permission model** supports three levels per tool (`allow`, `ask`, `deny`) with glob-based command-specific rules for Bash:

```json
{ "bash": { "*": "ask", "git status": "allow", "git push": "ask", "grep *": "allow" } }
```

### Plugin System

OpenCode has the richest extension model of the three harnesses:

**Two plugin sources**: local files (`.opencode/plugins/` or `~/.config/opencode/plugins/`) and npm packages (auto-installed via Bun at startup).

**All 30+ Event Bus events are hookable.** Plugins can intercept and modify tool calls via `tool.execute.before` / `tool.execute.after`, inject shell environment variables, respond to permission events, and hook into session compaction.

**Custom tools via plugins** can override built-in tools:

```typescript
import { tool } from "@opencode-ai/plugin";
export default tool({
  description: "Query the project database",
  args: { query: tool.schema.string().describe("SQL query to execute") },
  async execute(args) {
    return `Executed query: ${args.query}`;
  },
});
```

### AGENTS.md and Context Management

OpenCode uses **AGENTS.md** (analogous to Claude Code's CLAUDE.md) as the primary project instruction mechanism. It recognizes CLAUDE.md as a fallback for compatibility. Enhanced configuration supports glob patterns and remote URLs:

```json
"instructions": ["CONTRIBUTING.md", "docs/guidelines.md", ".cursor/rules/*.md"]
```

**System prompt layering** is provider-aware — Gemini gets different instructions than Claude or GPT.

**Context management** tracks tokens across three dimensions (input, cache, output). Auto-compaction triggers when usage approaches limits, using a hidden compaction agent to summarize. **Tool output pruning** complements full compaction: it protects the most recent 40K tokens, only prunes if saving at least 20K tokens, and never prunes skill outputs.

### Agent System

**Primary agents** (switchable via Tab): **Build** (full tool access) and **Plan** (restricted, read-only with edit/bash defaulting to `ask`).

**Subagents** (invoked via `task` tool or `@mention`): **General** (full tools except todo), **Explore** (read-only), and hidden system agents (Compaction, Title, Summary).

Custom agents are configured as JSON in `opencode.json` or Markdown files in `.opencode/agents/` with YAML frontmatter.

---

## Aider: The Git-Native Architecture

Aider takes the most radical position: **no tool-calling API, no sub-agents, no autonomous file discovery.** The LLM outputs text, Aider's parser applies edits, and the human drives. Git is the safety net, the undo system, and the single source of truth.

### The Architect/Editor Model Split

Aider's most influential innovation separates **reasoning** from **formatting** using a two-stage LLM pipeline:

```
User request
  → Architect model: proposes solution in natural language
    (no edit syntax, no formatting constraints, pure problem-solving)
  → Editor model: translates solution into Aider's edit format
    (narrowly prompted, focused on correct formatting)
```

This split lets you pair an expensive reasoning model with a cheap formatting model:

| Architect         | Editor              | Pass Rate |
| ----------------- | ------------------- | --------- |
| o1-preview        | DeepSeek or o1-mini | **85%**   |
| o1-preview        | Claude 3.5 Sonnet   | 82.7%     |
| Claude 3.5 Sonnet | Claude 3.5 Sonnet   | 80.5%     |
| GPT-4o            | GPT-4o              | 75.2%     |

The architect/editor split is a concrete implementation of the [Cost Tracking & Model Selection](../cost-tracking/README.md) pattern — routing different cognitive tasks to appropriately-sized models. It also anticipates the multi-model coordination trend that became standard across harnesses by early 2026. Cursor's "sketch + apply" and LangChain's "reasoning sandwich" are variations on the same idea.

### Repository Mapping: AST + PageRank

The repo map is Aider's core context management innovation and arguably its most influential contribution to the ecosystem. Traditional approaches consume ~1.2M tokens for 2000+ files; Aider's repo map uses **5-15K tokens** — a 98% reduction.

**How it works:**

1. **Tree-sitter parsing**: Parses source files into ASTs, extracts function/class definitions and references using language-specific `.scm` query files
2. **Graph construction**: Builds a directed graph where nodes are files and edges are references via shared identifiers. Edges are weighted: x10 for identifiers mentioned in chat, x10 for long snake/camelCase names, x0.1 for private identifiers, x50 for references from chat files
3. **PageRank**: Runs personalized PageRank with files in chat getting boosted initial weight. Rank distributes across edges proportional to weight, associating rank with specific (file, identifier) pairs
4. **Token fitting**: Binary search finds the maximum number of ranked tags that fit within the token budget (default 1024 tokens), rendering function/class signatures without full implementations

**Three-level caching** keeps this fast: disk cache (keyed by file + mtime), map cache (keyed by file lists + token budget), and tree cache (keyed by file + line numbers + mtime).

This is a completely different approach to the same problem Claude Code solves with ripgrep and OpenCode solves with LSP. The repo map is **deterministic** — you can inspect exactly what the model sees. It's **debuggable** — the PageRank scores explain why certain files are prioritized. And it **scales** — 5-15K tokens regardless of repo size. The tradeoff: it requires tree-sitter support for each language, and it shows signatures, not implementations.

### Edit Formats: Pluggable and Empirically Validated

Aider's most distinctive design choice: **the LLM doesn't call tools.** It outputs text containing edits, and Aider's parser applies them. This means the edit format is a critical architectural decision.

Aider supports 5+ edit formats, each optimized for different model behaviors:

| Format                         | Description                                 | Best For                        |
| ------------------------------ | ------------------------------------------- | ------------------------------- |
| **Whole**                      | LLM returns complete file                   | Highest accuracy, but expensive |
| **Diff (Search/Replace)**      | `<<<<<<< SEARCH` / `>>>>>>> REPLACE` blocks | General purpose, efficient      |
| **Diff-Fenced**                | File path inside the fence                  | Gemini models                   |
| **Udiff**                      | Modified unified diff (no line numbers)     | Combats "lazy coding"           |
| **Editor-Diff / Editor-Whole** | Simplified prompts for Architect mode       | Two-stage pipeline              |

The udiff format is a case study in benchmark-driven design. GPT-4 Turbo exhibited "lazy coding" — returning partial implementations with comments like `// rest of code here`. Switching to unified diffs improved scores from **20% to 61%** (3x improvement) because the format encouraged substantive code block edits over surgical line changes.

**Flexible patching** applies a 9-level fallback chain: exact match → whitespace-insensitive → indentation-preserving → fuzzy (via difflib) → normalized hunks → relative whitespace → broken hunks → varying context. Disabling this flexible matching causes a **9x increase in editing errors**. This is the defense-in-depth approach to [LLM Error Recovery](../error-recovery/README.md).

### Deep Git Integration

Git is Aider's primary safety net — not an optional feature. Every AI edit is **auto-committed** with a descriptive message generated by a cheap model using Conventional Commits format:

- `(aider)` appended to author/committer fields for attribution
- Dirty files committed separately before AI edits, keeping human and AI work distinct
- `/undo` reverts the last AI commit
- No proprietary undo stack — everything is standard git, reversible with standard tools

This is philosophically opposite to Claude Code and OpenCode, which treat git as the developer's responsibility. Aider makes git the foundation — if you're not in a git repo, core safety features are unavailable.

### No Sub-Agents, by Design

Aider runs a **single interaction loop** with zero sub-agent spawning. Instead of delegation, it relies on:

- **Repo map** for architectural understanding (replaces autonomous file exploration)
- **Explicit `/add` and `/drop`** for file management (human controls context)
- **Chat modes** (ask/code/architect) for different task types
- **Automatic lint/test feedback loops** for verification

The result: Aider achieves **52.7% accuracy using 126K tokens in 257 seconds** versus Claude Code's **55.5% using 397K tokens in 745 seconds**. Roughly 3x more efficient for 2.8 percentage points less accuracy.

This efficiency comes from a fundamentally different trust model. Aider trusts the human to manage context; Claude Code trusts the model to manage context. Neither is wrong — they optimize for different workflows.

### No Tool-Calling API

Aider does not use LLM tool-calling APIs at all. The LLM outputs text (edits + explanations) and Aider's parser extracts and applies them. All external actions are user-initiated via slash commands (`/add`, `/run`, `/test`, `/lint`, `/web`).

Benefits: more predictable behavior, no token overhead on tool schemas, simpler implementation, works with any model regardless of tool-calling support.

Tradeoffs: less autonomous (requires human involvement for file discovery, test running, etc.), the edit format must be robust enough to survive parsing, and the model must be prompted carefully to produce parseable output.

---

## Cross-Cutting Comparison

### Edit Strategies

How each harness gets code from the model's output into actual files:

| Approach                           | Harness               | How It Works                                                                          | Tradeoff                                                    |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Exact string replacement**       | Claude Code, OpenCode | `old_string` must be unique in file; replaced with `new_string`                       | Simple, reviewable, but fails on non-unique strings         |
| **Pluggable text formats**         | Aider                 | Model outputs edits in chosen format; parser applies them with 9-level fuzzy matching | Works without tool-calling API, but requires robust parsing |
| **String replace + patch + write** | OpenCode              | Three edit tools; LSP validates after every edit                                      | Most options, but more complexity for the model to navigate |

An emerging consensus across the ecosystem: successful edit formats share two properties — **avoid line numbers** (they're fragile and models miscount them) and **clearly delimit both the code to replace and its replacement.**

### Context Management

The three harnesses take fundamentally different approaches to the same problem — fitting a large codebase into a finite context window:

| Strategy                     | Harness               | Mechanism                                                   | Tradeoff                                                  |
| ---------------------------- | --------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| **Agentic search**           | Claude Code           | Model crafts ripgrep/glob queries; reads files on demand    | Flexible but depends on model's search skills             |
| **AST repo map**             | Aider                 | Tree-sitter + PageRank, 5-15K tokens for any repo           | Deterministic and compact, but shows signatures only      |
| **LSP-augmented search**     | OpenCode              | Text search + 30+ LSP servers for type info and diagnostics | Richest code understanding, but complex infrastructure    |
| **Auto-compaction**          | Claude Code, OpenCode | Summarize conversation at ~92-95% capacity                  | Preserves key info, but detailed instructions can be lost |
| **Persistent context files** | All three             | CLAUDE.md / AGENTS.md, loaded every session                 | Survives compaction and session boundaries                |
| **Auto memory**              | Claude Code           | MEMORY.md written by model, loaded at session start         | Cross-session learning without manual curation            |

The biggest insight from comparing these approaches: **there is no single "best" strategy.** The SWE-bench leaderboard analysis confirms that no single architecture consistently achieves state-of-the-art. Context engineering — choosing what enters the window and in what order — is the primary competitive differentiator, not the loop structure.

### Multi-Model Coordination

| Pattern                      | Harness                       | How It Works                                                      |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| **Architect/Editor split**   | Aider                         | Expensive model reasons; cheap model formats edits                |
| **Lead/sub-agent hierarchy** | Claude Code                   | Opus leads; Haiku explores; specialized agents for specific tasks |
| **Build/Plan modes**         | OpenCode                      | Full-access build agent; restricted read-only plan agent          |
| **Single model**             | (early versions of all three) | One model does everything                                         |

Anthropic reports that Claude Opus 4 as lead agent + Claude Sonnet 4 subagents outperformed single-agent Claude Opus 4 by **90.2%** on internal research evaluations. LangChain's "reasoning sandwich" — maximum reasoning at planning and verification, medium reasoning for implementation — scored **66.5% vs. 53.9%** for uniform max reasoning. Multi-model is no longer optional; it's the expected architecture.

### Extensibility

| Mechanism                | Claude Code                      | OpenCode                         | Aider                  |
| ------------------------ | -------------------------------- | -------------------------------- | ---------------------- |
| **Custom tools**         | Via MCP servers                  | Via plugins (override built-ins) | Not supported          |
| **Lifecycle hooks**      | 16+ events, shell/HTTP/prompt    | 30+ events via Event Bus         | Not supported          |
| **Custom agents**        | Markdown + YAML frontmatter      | JSON config or Markdown          | Not supported          |
| **Project instructions** | CLAUDE.md hierarchy              | AGENTS.md + glob imports         | Not supported          |
| **MCP**                  | Yes (tool search for large sets) | Yes (auto-client creation)       | Not supported          |
| **Edit formats**         | Fixed (search/replace)           | Fixed (3 formats)                | Pluggable (5+ formats) |

Aider's extensibility is focused entirely on model and edit format configuration — it's a tool, not a platform. Claude Code and OpenCode are both evolving toward platform status with rich extension models, but with different emphasis: Claude Code optimizes for context-cost-awareness, OpenCode optimizes for event-driven composability.

### Permission and Safety Models

| Approach             | Harness     | Design                                                                          |
| -------------------- | ----------- | ------------------------------------------------------------------------------- |
| **First-match-wins** | Claude Code | Deny > Ask > Allow evaluation order; 6-layer permission resolver                |
| **Glob-based rules** | OpenCode    | Per-tool `allow`/`ask`/`deny`; bash supports command-specific globs             |
| **Git-based safety** | Aider       | Auto-commit before every change; `/undo` to revert; user approves interactively |

Claude Code and OpenCode implement the [Human-in-the-Loop](../human-in-the-loop/README.md) pattern as a permission system that runs before every tool call. Aider implements it as a conversation model — the human is always in the loop because the human drives the interaction.

---

## Pattern Mapping: From This Repo to Production Harnesses

Every pattern you built in this repo appears in at least one production harness. This table maps them:

| Repo Pattern                                                      | Claude Code                                   | OpenCode                         | Aider                                  |
| ----------------------------------------------------------------- | --------------------------------------------- | -------------------------------- | -------------------------------------- |
| [ReAct Loop](../react/README.md)                                  | Core agent loop ("nO")                        | Core agent loop                  | Single interaction loop                |
| [Multi-Turn Memory](../conversation-memory/README.md)             | Message history + CLAUDE.md                   | SQLite sessions + AGENTS.md      | Chat history + repo map                |
| [Structured Output](../structured-output/README.md)               | Tool call schemas                             | Zod-validated tool params        | Edit format parsing                    |
| [Guardrails](../guardrails/README.md)                             | Permission resolver, sandbox                  | Permission model, git snapshots  | Git auto-commits, user approval        |
| [Human-in-the-Loop](../human-in-the-loop/README.md)               | PreToolUse hooks, AskUserQuestion             | Permission gates, `ask` mode     | Always-in-loop (pair programmer)       |
| [Context Window Management](../context-management/README.md)      | Auto-compaction at 92-95%                     | Token tracking + compaction      | Repo map + `/add`/`/drop`              |
| [Sub-Agent Delegation](../sub-agent-delegation/README.md)         | Explore/Plan/General agents (depth-1)         | Build/Plan/General/Explore       | Not used                               |
| [Streaming](../streaming/README.md)                               | Real-time token streaming                     | SSE event bus (30+ event types)  | Streaming text output                  |
| [Tool Description Engineering](../tool-descriptions/README.md)    | 18 carefully-prompted tool schemas            | 16+ Zod-validated tool schemas   | System prompt for edit format          |
| [Cost Tracking & Model Selection](../cost-tracking/README.md)     | Haiku for explore, inherits for others        | Configurable per-agent models    | Architect/Editor model split           |
| [On-Demand Skill Injection](../skill-injection/README.md)         | Skills system (descriptions until invoked)    | Skill tool                       | Not used                               |
| [Agent TODO Lists](../todo-lists/README.md)                       | TaskCreate + TODO injection in system prompts | todowrite/todoread tools         | Not used                               |
| [Persistent Cross-Session Memory](../persistent-memory/README.md) | MEMORY.md (auto) + CLAUDE.md (manual)         | AGENTS.md + session DB           | Git history                            |
| [Agent Middleware Pipeline](../middleware-pipeline/README.md)     | Hooks (16+ lifecycle events)                  | Plugin hooks (30+ events)        | Not used                               |
| [Ambient Context Store](../ambient-context/README.md)             | Subdirectory CLAUDE.md auto-loading           | Path-specific rules              | Repo map (auto-includes related files) |
| [MCP](../mcp/README.md)                                           | MCP servers + tool search                     | MCP auto-client creation         | Not used                               |
| [LLM Error Recovery](../error-recovery/README.md)                 | Model self-corrects via tool results          | LSP diagnostic feedback loop     | 9-level fuzzy patch fallback           |
| [Self-Validation](../self-validation/README.md)                   | Run tests → observe → fix cycle               | LSP diagnostics after every edit | Lint/test → feedback loop              |
| [Dual Return](../dual-return/README.md)                           | Text response + file edits (separate)         | Text + structured events via SSE | Text explanation + edit blocks         |

The patterns aren't just present — they're **composed**. A single Claude Code turn might involve: the ReAct loop calling the Grep tool (with engineered descriptions), spawning an Explore sub-agent (delegation + cost optimization), making an edit (with HITL permission check via hooks), getting a lint error (error recovery), fixing it, running tests (self-validation), and updating a TODO (agent scaffold) — all while auto-compaction manages the growing context (context management) and CLAUDE.md provides persistent conventions (cross-session memory).

---

## The Tool → Harness → Platform Evolution

The harness ecosystem is moving fast. Three trends define where it's headed:

### 1. Simplification Wins

The Bitter Lesson is playing out in real time. Vercel removed 80% of their agent tooling and saw accuracy go from 80% to 100%, tokens drop 37%, and speed improve 3.5x. Manus refactored their harness five times in six months. Claude Code's design philosophy — delete scaffolding as models improve — is being validated empirically.

LangChain improved from 30th to 5th on Terminal Bench 2.0 (52.8% → 66.5%) by changing **only the harness**, not the model. The harness matters more than the model above a capability floor.

### 2. Harnesses Become SDKs

Claude Code evolved into the Claude Agent SDK. OpenAI's Codex architecture is becoming embeddable. GitHub Copilot SDK lets you embed agents in any app. The pattern: successful harnesses extract their runtime into reusable SDKs, enabling other developers to build on the same infrastructure.

This is the "operating system" trajectory. Just as DOS became Windows became a platform for applications, harnesses are becoming platforms for agents.

### 3. Context Engineering Is the Competitive Moat

The SWE-bench leaderboard analysis across 7 architectural groups found **no single architecture consistently achieves state-of-the-art.** What differentiates top performers is context engineering — how they decide what enters the context window:

- **Aider**: Tree-sitter + PageRank for deterministic, compact repo maps
- **Augment (Auggie)**: Full semantic indexing that topped SWE-bench Pro
- **Windsurf**: Flow awareness tracking all developer actions
- **Claude Code**: Agentic search where the model discovers relevant code dynamically
- **Manus**: Filesystem-as-memory with KV-cache optimization (10x cost reduction)

The model that sees the right code wins. Everything else is plumbing.

---

## Key Takeaways

1. **Harnesses are thin by design.** Claude Code's core loop is ~50 lines. The intelligence is in the model and the context engineering, not in complex orchestration graphs. If your harness is getting more complex while models improve, you're over-engineering.

2. **There's no single winning architecture.** Three successful harnesses make fundamentally different bets: model-driven (Claude Code), platform-first (OpenCode), human-driven (Aider). The SWE-bench analysis confirms no single paradigm dominates. Pick the tradeoffs that match your workflow.

3. **Every pattern composes.** The patterns in this repo aren't academic exercises — they're the building blocks of every tool you use daily. Understanding them individually lets you understand how they compose at scale.

4. **Context engineering > loop engineering.** The agent loop is a solved problem (while/true + tool calls). The unsolved problem is deciding what the model sees. Repo maps, auto-compaction, tiered memory, LSP feedback, agentic search — these are the active frontiers.

5. **The edit format matters more than you'd expect.** Aider's 3x improvement from switching edit formats, the 9x error increase from disabling fuzzy matching, the convergence on "avoid line numbers" — edit strategy is a make-or-break architectural decision for coding agents.

6. **Multi-model coordination is table stakes.** Architect/editor splits, lead/sub-agent hierarchies, reasoning sandwiches — the days of one model doing everything are over. Route cognitive tasks to appropriately-sized models.

7. **Human oversight isn't going away.** Despite improving benchmarks, professional developers maintain active control. The most productive workflows (explore-plan-code-commit, TDD, writer/reviewer) all include explicit human checkpoints. The best harnesses make this easy, not optional.

---

## Sources & Further Reading

### Primary Harness Documentation

- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [OpenCode Documentation](https://opencode.ai/docs/)
- [Aider Documentation](https://aider.chat/docs/)

### Harness Architecture Analysis

- [Effective Harnesses for Long-Running Agents — Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [How Coding Agents Actually Work: Inside OpenCode — Moncef Abboud](https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/)
- [Understanding AI Coding Agents Through Aider's Architecture — Simran Chawla](https://simranchawla.com/understanding-ai-coding-agents-through-aiders-architecture/)

### Ecosystem & Trends

- [The Rise of the Agent Harness — Agile Lab](https://agilelab.substack.com/p/the-rise-of-the-agent-harness)
- [The Importance of Agent Harness in 2026 — Philipp Schmid](https://www.philschmid.de/agent-harness-2026)
- [The Agent Harness Is the Architecture — Evangelos Pappas](https://dev.to/epappas/the-agent-harness-is-the-architecture-and-your-model-is-not-the-bottleneck-3bjd)
- [Agent OS: We're Building DOS Again — Vonng](https://blog.vonng.com/en/db/agent-os/)
- [How Claude Code is Built — Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built)

### Edit Strategies

- [Aider Architect/Editor Pattern](https://aider.chat/2024/09/26/architect.html)
- [Unified Diffs Make GPT-4 Turbo 3x Less Lazy — Aider](https://aider.chat/docs/unified-diffs.html)
- [Code Surgery: How AI Assistants Make Precise Edits — Fabian Hertwig](https://fabianhertwig.com/blog/coding-assistants-file-edits/)

### Harness Engineering

- [Harness Engineering — Martin Fowler / Thoughtworks](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
- [Harness Engineering — OpenAI](https://openai.com/index/harness-engineering/)
- [Improving Deep Agents with Harness Engineering — LangChain](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/)

### Research

- [Dissecting SWE-Bench Leaderboards](https://arxiv.org/abs/2506.17208) — architectural classification of top agents
- [Codified Context: Infrastructure for AI Agents in Complex Codebases](https://arxiv.org/abs/2602.20478) — three-tier knowledge architecture
- [A Survey on Code Generation with LLM-based Agents](https://arxiv.org/abs/2508.00083) — comprehensive taxonomy
- [SWE-bench Leaderboard](https://www.swebench.com/)

---

[Agent Patterns — TypeScript](../../README.md)
