# Your Coding Agent Is a General-Purpose Agent Runtime

You've just finished studying how Claude Code, OpenCode, and Aider work under the hood — the agent loops, tool systems, context management, sub-agents, hooks, and permission models. You understand the harness layer. Now here's the twist: **none of those capabilities are specific to coding.**

Filesystem access works on spreadsheets, not just source files. Sub-agent delegation parallelizes financial analysis the same way it parallelizes codebase exploration. Context compaction keeps a legal research session coherent the same way it keeps a debugging session coherent. Permission systems gate access to production databases the same way they gate access to `rm -rf`.

This isn't theoretical. Anthropic renamed the "Claude Code SDK" to "Claude Agent SDK" because, in their words, "the agent harness that powers Claude Code can power many other types of agents, too." Companies are building production agents for cybersecurity, financial analytics, legal research, and retail operations on the exact same infrastructure that powers coding agents.

This guide explores the pattern: why coding harness infrastructure is reusable, how it's being adapted for non-coding domains, and when you should build on it versus building from scratch.

---

## Why Coding Harness Infrastructure Transfers

The [Coding Agent Harness Architecture](../coding-agent-harness-architecture/README.md) guide showed that harnesses solve seven hard infrastructure problems. Here's the key insight: **every one of them is domain-agnostic.**

| Infrastructure Problem                             | Why Coding Agents Need It             | Why Domain Agents Need It Too                                    |
| -------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| **Filesystem access** (read, write, search)        | Navigate source code                  | Navigate documents, spreadsheets, reports, configs               |
| **Command execution** (bash, scripts)              | Run tests, build tools, linters       | Run data pipelines, API calls, analysis scripts                  |
| **Sub-agent delegation**                           | Parallelize multi-file exploration    | Parallelize multi-source research, multi-step analysis           |
| **Context management** (compaction, tiered memory) | Keep long debugging sessions coherent | Keep long research or audit sessions coherent                    |
| **Permission systems**                             | Gate access to dangerous commands     | Gate access to production systems, PII, regulated data           |
| **Skill/instruction injection**                    | Load framework-specific knowledge     | Load domain expertise (financial regulations, medical protocols) |
| **Session management** (state, resumability)       | Resume interrupted refactoring        | Resume interrupted analysis, multi-day investigations            |
| **MCP integration**                                | Connect to dev tools (GitHub, CI/CD)  | Connect to business tools (Salesforce, Jira, databases)          |

Anthropic discovered this building Claude Code. The agent needed to "research, plan, review, verify, and communicate" — capabilities that turned out to be universally applicable. The agentic loop itself — **gather context, take action, verify work, repeat** — describes an observability investigation as naturally as it describes a bug fix.

---

## The Claude Code → Agent SDK → Cowork Pipeline

The clearest evidence of this pattern is Anthropic's own product evolution, which traces a direct line from coding tool to general-purpose agent platform.

### Phase 1: Claude Code discovers generality (2024-2025)

Built as an internal coding tool, Claude Code quickly expanded beyond code. Internally at Anthropic, it began powering "almost all of our major agent loops" — including deep research, video creation, and note-taking. The coding-specific tools (Edit, Grep, Glob) were useful for code, but the general-purpose tools (Read, Bash, WebSearch, WebFetch) and the infrastructure around them (context management, sub-agents, hooks) worked for anything.

### Phase 2: The SDK extraction (May → September 2025)

Anthropic extracted the Claude Code runtime into a standalone SDK. Initially named "Claude Code SDK," it was **renamed to "Claude Agent SDK"** in September 2025 — an explicit acknowledgment that the harness had outgrown its original domain.

The SDK bundles the entire Claude Code CLI binary as a subprocess. When you call `query()`, you're not making raw API calls — you're spawning the same runtime that powers Claude Code, complete with:

- **14+ built-in tools**: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task (sub-agents)
- **18 lifecycle hooks**: PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, and more
- **Auto-context compaction**: Summarizes conversation near token limits
- **Permission engine**: Fine-grained tool access control
- **MCP integration**: Connect to any external system
- **Skills**: Load domain expertise on demand via SKILL.md files

The [Vendor Agent SDKs](../vendor-agent-sdks/README.md) guide covers the SDK's subprocess architecture in detail. What matters here is the implication: **any agent you build on this SDK inherits the same reliability infrastructure that makes Claude Code work.**

### Phase 3: Cowork — the non-developer product (January 2026)

Claude Cowork launched as an automation tool for knowledge workers — non-developers who need agent capabilities for documents, spreadsheets, presentations, and research. It was built on the same Agent SDK infrastructure **in less than two weeks**.

That build time is the strongest evidence for the pattern. The hard problems — tool execution, context management, permission systems, session state — were already solved. Cowork just needed a different interface (desktop app instead of CLI) and different default skills.

### Phase 4: Enterprise plugins (February 2026)

Anthropic launched 13 enterprise MCP connector plugins for Cowork spanning:

| Domain          | Plugins                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| **Finance**     | Financial analysis, investment banking, equity research, private equity, wealth management, FactSet, MSCI |
| **HR**          | Employee lifecycle support                                                                                |
| **Engineering** | Process documentation, vendor evaluations, change request tracking                                        |
| **Design**      | UX copy, accessibility audits                                                                             |
| **Legal**       | LegalZoom integration                                                                                     |
| **Connectors**  | Google Workspace, DocuSign, Apollo, Clay, Outreach, SimilarWeb, WordPress, Harvey                         |

PwC partnered with Anthropic to develop industry-specific skills and connectors for finance and healthcare — regulated domains where the permission system and audit capabilities from coding agents directly apply.

The pipeline is clear: **Tool → Harness → SDK → Platform → Ecosystem.** Each step reuses the infrastructure from the previous one.

---

## OpenCode: The Headless Platform Approach

While Anthropic's approach extracts the harness into an SDK, OpenCode demonstrates a different path: **the harness itself is a platform** thanks to its client-server architecture.

### Architecture recap

As covered in the [harness architecture guide](../coding-agent-harness-architecture/README.md), OpenCode separates the agent backend (Bun + Hono HTTP server) from the user interface. The backend exposes REST APIs and SSE event streams. Any HTTP client can interact with it.

```
                    ┌─────────────────────┐
                    │  OpenCode Backend    │
                    │  (Bun + Hono)        │
                    │                      │
                    │  Agent Loop          │
                    │  Tool Execution      │
                    │  LSP Integration     │
                    │  Session Management  │
                    │  Event Bus           │
                    └──────┬──────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼───┐  ┌────▼───┐  ┌────▼───┐
         │  TUI   │  │Desktop │  │  Web   │
         │Client  │  │  App   │  │Client  │
         └────────┘  └────────┘  └────────┘
```

This means you can build a domain-specific agent by:

1. **Running OpenCode in headless mode** (`opencode serve`)
2. **Connecting your own frontend** via HTTP/SSE
3. **Configuring domain behavior** through AGENTS.md, custom tools, and plugins

### Configuration-based domain agents

A practitioner demonstrated this by building an **AWS architecture agent** with zero code changes to OpenCode:

1. Added AWS Documentation MCP Server and AWS Diagram MCP Server
2. Restricted bash access, enabled only read operations + AWS tools
3. Customized AGENTS.md with AWS-specific prompts
4. Result: a functioning architecture design agent through pure configuration

This is possible because OpenCode's agent system is fully configurable:

```markdown
## <!-- .opencode/agents/security-analyst.md -->

description: Security analyst for vulnerability assessment
model: claude-sonnet-4-6
temperature: 0.3
tools:

- read
- grep
- glob
- bash
- webfetch
  permissions:
  bash: ask
  edit: deny
  write: deny

---

You are a senior security analyst. Your role is to...
```

### Why the client-server approach matters for domain agents

| Property                         | Benefit for Domain Agents                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **HTTP API**                     | Embed agent capabilities in existing web apps, dashboards, Slack bots                                             |
| **SSE event stream**             | Real-time progress updates in domain-specific UIs                                                                 |
| **75+ LLM providers**            | Choose models based on domain requirements (cost, latency, compliance)                                            |
| **Plugin system**                | Add domain-specific tools without forking the harness                                                             |
| **LSP integration**              | Not just for code — LSP servers exist for YAML, JSON schemas, Terraform, and config languages used in ops domains |
| **Session persistence** (SQLite) | Resume investigations across browser sessions, team handoffs                                                      |

The tradeoff compared to the SDK approach: OpenCode gives you a running server to integrate with; the Claude Agent SDK gives you a library to embed. The server approach is easier for teams building on top of the agent (add a frontend, done). The library approach is better for teams building the agent _into_ another product.

---

## The Configuration-to-Code Spectrum

Not every domain agent requires writing code. The harness ecosystem offers a spectrum of customization levels:

```
Pure Config                                                    Full Code
─────────────────────────────────────────────────────────────────────────
CLAUDE.md    →   SKILL.md    →   Cowork       →   Agent SDK   →  Custom
/AGENTS.md       /Skills         Plugins           (query())      Harness
Roo Modes                        (admin UI)
```

### Layer 1: Markdown configuration (zero code)

A single file in the project root shapes agent behavior through natural language instructions.

**CLAUDE.md** (Claude Code) and **AGENTS.md** (OpenCode) define project conventions, tool restrictions, and behavioral guidelines. **Roo Code custom modes** add persona, tool restrictions, and file regex patterns via YAML.

```markdown
<!-- AGENTS.md for an observability agent -->

# Observability Agent

## Tools

- Always use `grep` and `glob` before `bash` for log analysis
- Never modify production config files
- Use the Datadog MCP server for metric queries

## Workflow

1. Gather symptoms from the user's description
2. Query relevant dashboards and logs
3. Form hypotheses and test each one
4. Present root cause analysis with evidence
```

**What you can control:** System prompt, persona, tool enable/disable, file restrictions, model selection, behavioral guidelines.

**What you cannot control:** Custom tool implementations, external API integration logic, programmatic orchestration, custom business logic.

### Layer 2: Skills (the bridge between config and code)

Skills follow the [Agent Skills open standard](https://agentskills.io/specification), now supported by 20+ platforms including Claude Code, OpenCode, Cursor, VS Code Copilot, and OpenAI Codex.

A skill is a directory containing a SKILL.md with YAML frontmatter plus optional bundled scripts:

```
skills/
  threat-analysis/
    SKILL.md          # Instructions + YAML frontmatter
    scripts/
      enrich-ioc.py   # Called via bash when needed
      parse-pcap.sh
    references/
      mitre-attack.md # Loaded on demand
```

Skills sit at the compositional sweet spot. They're config-like (markdown + YAML) but code-like (bundled scripts, tool permissions, sub-agent delegation). They're portable across platforms. Claude Code extends the standard with `context: fork` (run in sub-agent), dynamic context injection, and sub-agent delegation.

**Key capability**: progressive disclosure. Only name + description load at startup (~100 tokens). Full SKILL.md loads on activation. Scripts and references load on demand. This means you can have dozens of domain skills without polluting the context window — the [On-Demand Skill Injection](../skill-injection/README.md) pattern.

### Layer 3: Cowork Plugins (enterprise no-code)

Cowork bundles skills, commands, and MCP connectors into department-specific plugins configured through an admin UI. They're described as "simple, portable file systems that you own" — the same SKILL.md + MCP infrastructure, packaged for knowledge workers.

This is the layer where non-technical teams can build domain agents. A finance team adds the FactSet MCP connector and a financial analysis skill bundle. An HR team adds the Google Workspace connector and employee lifecycle skills. No code required.

### Layer 4: Agent SDK (full programmatic control)

When configuration isn't enough — when you need custom business logic, programmatic orchestration, or CI/CD integration — the Claude Agent SDK gives you the full harness as a library:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Analyze the production incident from the last hour",
  options: {
    systemPrompt: "You are a senior SRE. Follow the incident response playbook.",
    allowedTools: ["Read", "Bash", "Glob", "Grep", "WebFetch"],
    permissionMode: "default",
    mcpServers: {
      datadog: { command: "npx", args: ["-y", "@datadog/mcp-server"] },
      pagerduty: { command: "npx", args: ["-y", "@pagerduty/mcp-server"] },
    },
    hooks: {
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [{ command: "node", args: ["audit-log.js"] }],
        },
      ],
    },
    maxBudgetUsd: 2.0,
  },
})) {
  // Stream results to your incident dashboard
}
```

This is where the user's observation about using OpenCode to build observability/monitoring/analysis/debugging agents lives. The SDK (or OpenCode's HTTP API) provides the runtime; your code provides the domain logic, integrations, and user interface.

### Decision guide: where on the spectrum?

| Your Situation                            | Start Here            | Why                                               |
| ----------------------------------------- | --------------------- | ------------------------------------------------- |
| Internal team conventions                 | CLAUDE.md / AGENTS.md | Zero code, version-controlled, everyone benefits  |
| Domain-specific workflows                 | Skills (SKILL.md)     | Portable, progressive disclosure, bundled scripts |
| Non-technical department                  | Cowork Plugins        | Admin UI, pre-built connectors, no code           |
| Custom product with agent features        | Agent SDK             | Full programmatic control, embeddable             |
| Existing web app needs agent backend      | OpenCode headless     | HTTP API, SSE events, plug into any frontend      |
| Multi-model or non-Anthropic requirements | OpenCode or custom    | Provider agnostic, full architectural control     |

---

## Production Case Studies

These aren't hypotheticals — companies are running domain agents on harness infrastructure in production today.

### BGL: Financial Analytics Agent

**Domain**: Self-managed superannuation fund administration (financial services, Australia)

**Problem**: Business users relied on data teams for ad-hoc queries across 400+ analytics tables, creating bottlenecks and delays.

**Solution**: An AI agent built on the Claude Agent SDK + Amazon Bedrock AgentCore. The agent interprets natural language questions, generates SQL queries, executes them, and presents results.

**Harness patterns used**: CLAUDE.md for project context, SKILL.md files for product-specific domain expertise (exactly the same patterns from Claude Code), tool restrictions to limit the agent to read-only database operations.

**Impact**: 200+ employees can now validate hypotheses instantly without waiting for data engineering teams.

### eSentire: Cybersecurity Threat Analysis

**Domain**: Security Operations Center (SOC) investigation

**Problem**: Expert threat analysis — formulating hypotheses, gathering evidence, correlating indicators — took 5 hours per investigation.

**Solution**: An agent that follows the same agentic loop as a coding agent: gather context (threat indicators), take action (query security tools), verify (correlate evidence), repeat. It dynamically selects investigation tools and adjusts strategy based on intermediate findings.

**Validation**: Tested against 1,000 real-world investigations. 95% alignment with senior SOC expert assessments.

**Impact**: 5 hours → 7 minutes per investigation. 99.3% initial host threat suppression rate.

### L'Oreal: Conversational Retail Analytics

**Domain**: Business analytics across 37+ international brands

**Solution**: Claude orchestrates multiple specialized agents — semantic API agents, data retrieval systems, calculation agents, master data agents. This is the [Sub-Agent Delegation](../sub-agent-delegation/README.md) pattern applied to retail instead of code.

**Impact**: 99.9% accuracy (up from 90% with previous AI), 44,000 monthly users querying data conversationally.

### Thomson Reuters: Legal Research (CoCounsel)

**Domain**: Legal research and document analysis

**Solution**: An agent providing access to 150 years of case law and 3,000 domain experts. The core pattern — search a large corpus, synthesize findings, present with citations — mirrors how a coding agent searches a codebase and presents findings.

**Impact**: Hours of manual document searches compressed to minutes.

### The Pattern Across All Cases

Every production case study follows the same template:

1. **Take a working harness loop** (gather → act → verify → repeat)
2. **Swap the tools** (grep for code → SQL for data, linters → compliance checkers)
3. **Swap the skills** (programming knowledge → domain expertise)
4. **Keep the infrastructure** (context management, permissions, sessions, sub-agents)

The harness did the heavy lifting. The domain adaptation was configuration and integration.

---

## The Seven Reusable Properties of a Harness

Based on the research and case studies, these are the architectural properties that make a coding harness transferable to other domains:

### 1. Domain-agnostic tool primitives

Read, Write, Execute, Search — these work with any file type. A `Read` tool that opens Python files also opens CSV files, legal briefs, or configuration manifests. A `Bash` tool that runs `pytest` also runs `psql`, `curl`, or custom analysis scripts.

### 2. Configurable tool permissions

The same permission system that prevents a coding agent from running `rm -rf` prevents a financial agent from executing unauthorized trades. The granularity matters: per-tool, per-command, per-agent, with glob patterns for nuanced control.

### 3. Pluggable external integrations (MCP)

[MCP](../mcp/README.md) standardizes how agents connect to external systems. An MCP server for GitHub works the same way as an MCP server for Salesforce or Datadog — the harness doesn't care what's on the other end. This is why MCP adoption (10,000+ servers, 97 million downloads) is the biggest enabler of the harness-as-platform pattern.

### 4. Skill/instruction injection

Domain expertise loaded on demand without modifying the harness. A coding agent loads React documentation; a financial agent loads SEC filing templates; a security agent loads MITRE ATT&CK frameworks. Same mechanism, different content.

### 5. Sub-agent delegation

Task decomposition and parallel execution are domain-agnostic. A coding agent spawns Explore sub-agents for codebase investigation; an observability agent spawns sub-agents for parallel log analysis across services. The isolation model (separate context, restricted tools, summary return) transfers directly.

### 6. Session management with resumability

Long-running investigations — whether debugging a production incident or auditing financial records — need to survive interruptions. Session persistence (SQLite in OpenCode, agent IDs in Claude Code) enables multi-day workflows.

### 7. Lifecycle hooks

Deterministic automation at key points. A coding hook runs linters after edits; a compliance hook logs every tool call for audit trails; a security hook blocks access to sensitive file paths. Same hook system, different policies.

---

## The Harness-as-Platform Thesis

### Why this matters now

The APEX-Agents benchmark tested AI agents on professional tasks across investment banking, consulting, and legal domains. Manus's filesystem-as-memory and context compaction techniques — developed for coding workflows — proved transferable without fundamental redesign. The 50-tool-call workflow patterns worked across domains.

Enterprise statistics from Anthropic's 2026 report:

- **90%** of organizations use AI for development assistance (coding leads adoption)
- **60%** rank data analysis as their most impactful agentic AI application
- **48%** cite internal process automation
- **81%** plan to tackle more complex non-coding use cases in 2026

The gap between coding adoption (90%) and non-coding adoption (60%) is closing fast as the harness infrastructure matures.

### The "harness is the new framework" argument

Agile Lab argues that as models become commoditized, **"the model is increasingly a commodity — the harness determines whether agents succeed or fail."** Once processors crossed a sufficiency threshold in smartphones, value shifted to OS infrastructure. Similarly, once models reach capability floors (GPT-4-class and above), the harness determines outcomes.

Martin Fowler's Thoughtworks analysis suggests harnesses could become **"future service templates"** — pre-built, domain-adapted agent runtimes you pick from a catalog. Pick the observability harness. Pick the financial analysis harness. Pick the legal research harness. Each one is a configured instance of the same underlying infrastructure.

### Where sources disagree

Not everyone is convinced the pattern is fully proven:

**Anthropic's own engineering blog** acknowledges their long-running agent demo is "optimized for full-stack web app development" and that generalizing to other fields is "a future direction." The theory is ahead of the formal documentation.

**Practitioners are ahead of theory.** The case studies (eSentire, BGL, L'Oreal) demonstrate working production agents on harness infrastructure. The market — Cowork, enterprise plugins, PwC partnership — has already moved past the theoretical debate.

**The "scaffolding" concern.** Some argue that harness logic should be "something you can remove when the model no longer needs it." If models keep improving, today's context compaction and sub-agent delegation might become unnecessary. The counterargument: even if individual mechanisms become obsolete, the _category_ of infrastructure (permission systems, audit trails, session management) doesn't go away — it just gets simpler.

---

## Decision Framework: Build On Harness Infrastructure or Build From Scratch?

### Build on harness infrastructure when:

- Your agent follows the **gather → act → verify → repeat** loop
- You need **file/document access** as a core capability
- You need **permission systems** and audit trails
- You want **MCP connectors** to existing business tools
- You need **sub-agent delegation** for parallel workflows
- You're using **Anthropic models** (Claude Agent SDK) or want **provider flexibility** (OpenCode)
- **Time-to-production** matters more than architectural customization

### Build from scratch when:

- Your agent loop is fundamentally different (e.g., real-time event processing, not request-response)
- You need **multi-model architectures** beyond what the harness supports (Aider-style architect/editor splits with non-Claude models)
- Your domain requires **custom context management** that conflicts with the harness's approach
- You're building a **platform for other developers** and need full architectural control
- **Latency requirements** are tighter than subprocess spawning allows
- You need **embedding-based retrieval** (neither Claude Code nor OpenCode use vector databases)

### The hybrid approach

Many production systems combine both: harness infrastructure for the core agent loop with custom code for domain-specific integrations. The Claude Agent SDK's hooks system enables this — your custom logic runs at lifecycle events without forking the harness. OpenCode's plugin system achieves the same through event bus hooks and custom tool definitions.

---

## Connecting Back to This Repo

The patterns you built in this repo aren't just learning exercises — they're the building blocks of every domain agent:

| Repo Pattern                                                      | How It Applies to Domain Agents                                      |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| [ReAct Loop](../react/README.md)                                  | The universal agent loop: works for code, data, research, operations |
| [Tool Description Engineering](../tool-descriptions/README.md)    | Domain tools need the same careful prompt engineering                |
| [Sub-Agent Delegation](../sub-agent-delegation/README.md)         | Parallelize investigation, analysis, or research across sub-domains  |
| [Context Window Management](../context-management/README.md)      | Long investigations hit the same limits as long debugging sessions   |
| [On-Demand Skill Injection](../skill-injection/README.md)         | Load domain expertise exactly like loading framework docs            |
| [Human-in-the-Loop](../human-in-the-loop/README.md)               | Permission gates for regulated domains (finance, healthcare, legal)  |
| [Persistent Cross-Session Memory](../persistent-memory/README.md) | CLAUDE.md/AGENTS.md work the same for any domain                     |
| [MCP](../mcp/README.md)                                           | The universal connector layer between agents and external systems    |
| [Agent Middleware Pipeline](../middleware-pipeline/README.md)     | Hooks for audit logging, compliance checks, custom validation        |
| [Ambient Context Store](../ambient-context/README.md)             | Domain context that loads based on what the agent is working on      |
| [Cost Tracking & Model Selection](../cost-tracking/README.md)     | Route domain tasks to appropriately-sized models                     |

Understanding these patterns individually lets you see exactly which components transfer and which need adaptation. The loop transfers. The tools transfer. The context management transfers. What changes is the _content_ — the skills, the MCP connections, the permission policies — not the infrastructure.

---

## Key Takeaways

1. **Coding harness infrastructure is domain-agnostic by accident of necessity.** Coding agents needed research, planning, verification, and communication — capabilities that apply everywhere. The infrastructure that makes a debugging agent reliable also makes a financial analysis agent reliable.

2. **The Claude Code → Agent SDK → Cowork pipeline proves the pattern.** A coding tool became a general-purpose SDK became a non-developer product with enterprise plugins — each step reusing the previous step's infrastructure. Cowork was built in under two weeks.

3. **Configuration goes further than you'd expect.** Between CLAUDE.md/AGENTS.md, skills, MCP connectors, and custom agent definitions, many domain agents can be built through configuration alone — no code changes to the harness.

4. **When you do need code, the SDK gives you the full runtime.** The Claude Agent SDK bundles the same agent loop, tools, context management, and hooks that power Claude Code. OpenCode's HTTP API gives you the same via a server you can integrate with any frontend.

5. **MCP is the biggest enabler.** With 10,000+ MCP servers covering databases, APIs, and business tools, the connector layer is what makes domain adaptation practical. The harness provides the loop; MCP provides the domain access.

6. **The "harness is the new framework" thesis is playing out in real time.** As models commoditize, the differentiator shifts to harness infrastructure. Organizations that invest in reusable harness infrastructure — rather than building bespoke agents per use case — will move faster.

7. **You already know the patterns.** If you've been following this repo, you've built every component that goes into a production domain agent. The harness is just these patterns composed at scale with opinionated defaults.

---

## Sources & Further Reading

### The Claude Code → SDK → Cowork Evolution

- [Building Agents with the Claude Agent SDK](https://claude.com/blog/building-agents-with-the-claude-agent-sdk)
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart)
- [Claude Cowork Research Preview](https://claude.com/blog/cowork-research-preview)
- [Cowork Plugins Across Enterprise](https://claude.com/blog/cowork-plugins-across-enterprise)
- [Claude Agent SDK Demos — GitHub](https://github.com/anthropics/claude-agent-sdk-demos)

### OpenCode as Platform

- [How Coding Agents Actually Work: Inside OpenCode — Moncef Abboud](https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/)
- [OpenCode Agents Documentation](https://opencode.ai/docs/agents/)
- [OpenCode Plugins Documentation](https://opencode.ai/docs/plugins/)
- [OpenCode Server Documentation](https://opencode.ai/docs/server/)
- [Using Your Own Architecture Agent with OpenCode — GitAroktato](https://dev.to/gitaroktato/using-your-own-architecture-agent-with-opencode-and-aws-mcp-servers-2j26)

### Production Case Studies

- [BGL: Democratizing Business Intelligence with Claude Agent SDK](https://aws.amazon.com/blogs/machine-learning/democratizing-business-intelligence-bgls-journey-with-claude-agent-sdk-and-amazon-bedrock-agentcore/)
- [eSentire: Cybersecurity Threat Analysis](https://claude.com/customers/esentire)
- [L'Oreal: Conversational Analytics](https://claude.com/customers/loreal)
- [How Enterprises Are Building AI Agents in 2026 — Anthropic](https://claude.com/blog/how-enterprises-are-building-ai-agents-in-2026)

### Harness-as-Platform Ecosystem

- [The Rise of the Agent Harness — Agile Lab](https://agilelab.substack.com/p/the-rise-of-the-agent-harness)
- [The Importance of Agent Harness in 2026 — Philipp Schmid](https://www.philschmid.de/agent-harness-2026)
- [Harness Engineering — Martin Fowler / Thoughtworks](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
- [Agent Skills Specification — agentskills.io](https://agentskills.io/specification)
- [2026 Agentic Coding Trends Report — Anthropic](https://resources.anthropic.com/2026-agentic-coding-trends-report)

### Previous Guides in This Repo

- [Coding Agent Harness Architecture](../coding-agent-harness-architecture/README.md) — how Claude Code, OpenCode, and Aider work internally
- [Vendor Agent SDKs](../vendor-agent-sdks/README.md) — Claude Agent SDK vs OpenAI Agents SDK vs Google ADK
- [Agent Framework Landscape](../agent-framework-landscape/README.md) — the 4-layer agent stack taxonomy

---

[Agent Patterns — TypeScript](../../README.md)
