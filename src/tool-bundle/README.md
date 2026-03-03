# Not Every User Gets Every Tool — Dynamic Tool Bundles for Multi-Tenant Agents

[Agent Patterns — TypeScript](../../README.md) · Builds on [MCP (Model Context Protocol)](../mcp/README.md)

---

Your agent has 30 tools. Your users have access to maybe 8. One org has GitHub and Slack. Another has GitHub and Jira. A third has only GitHub. If you give every user all 30 tools, three things go wrong: the LLM hallucinates calls to tools the user can't use, you waste context tokens on irrelevant tool definitions, and you risk credential leaks when a tool executes with the wrong org's token.

The **Tool Bundle System** solves this by making integration tools conditionally available — grouped into bundles, enabled per-org, with credentials loaded lazily. The agent code stays identical regardless of which org is active. Only the injected tool set and credential resolver change.

## The Three-Layer Architecture

The core insight is separating _what tools exist_ from _who gets them_ from _how they authenticate_:

```
Layer 1: BUNDLE_REGISTRY (static code)
  github → [github.create_pr, github.list_issues, github.check_ci_status]
  slack  → [slack.send_message, slack.list_channels, slack.get_thread]
  jira   → [jira.create_ticket, jira.update_ticket, jira.search_tickets]

Layer 2: ORG_INTEGRATIONS (database)
  acme    → [github, slack]     → 6 tools
  globex  → [github, jira]      → 6 tools
  initech → [github]            → 3 tools

Layer 3: SESSION_CREDENTIALS (lazy-loaded per tool call)
  acme.github → { token: "ghp_acme_...", org: "acme-corp" }
  acme.slack  → { token: "xoxb-acme_...", workspace: "acme-hq" }
  globex.jira → { token: "jira_globex_...", site: "globex.atlassian.net" }
  ...
```

Each layer serves a different audience and changes at a different cadence:

| Layer                   | Who changes it     | How often                         | What it controls                    |
| ----------------------- | ------------------ | --------------------------------- | ----------------------------------- |
| **Bundle Registry**     | Developer          | At deploy time                    | Which tools exist and their schemas |
| **Org Integrations**    | Admin              | When adding/removing integrations | Which bundles each org can use      |
| **Session Credentials** | OAuth flow / vault | Per-session or on token refresh   | How tools authenticate              |

## Namespace Prefixing

Every tool name is prefixed with its bundle name: `github.create_pr`, `slack.send_message`, `jira.create_ticket`. This serves two purposes:

**1. Collision avoidance.** Both GitHub and Jira have concepts of "issues" and "tickets." Without namespacing, `create_issue` would be ambiguous when both bundles are active for the same org.

**2. Credential routing.** When `executeTool` receives a call to `jira.create_ticket`, it extracts the `jira` prefix to know which bundle's credentials to load. The prefix _is_ the routing key:

```typescript
function executeTool(name: string, args: Record<string, string>): string {
  const bundleName = name.slice(0, name.indexOf("."));
  // → "jira"

  // Verify bundle is enabled for this org
  if (!activeBundles.includes(bundleName)) {
    return JSON.stringify({ error: `Bundle '${bundleName}' not enabled` });
  }

  // Lazy-load credentials (cached after first load)
  if (!credentialCache[bundleName]) {
    credentialCache[bundleName] = getCredentials(orgId, bundleName);
  }

  return executeToolImpl(name, args, credentialCache[bundleName]);
}
```

## Lazy Credential Loading

Credentials aren't loaded when the session starts — they're loaded when a tool from that bundle is first called. This matters for two reasons:

**Security.** If Acme has GitHub + Slack enabled but only asks about pull requests, the Slack token is never loaded into memory. Fewer credentials in memory means a smaller blast radius if something goes wrong.

**Performance.** Loading credentials often involves network calls (vault lookups, token refreshes, OAuth exchanges). A session that never touches Jira never pays the cost of fetching Jira credentials. In our demo we simulate this with a console log, but in production this would be a vault call or token refresh.

Once loaded, credentials are cached for the session — the lazy load happens once per bundle, not once per tool call.

## Session-Frozen Tool Sets

When `buildSessionConfig()` runs, it snapshots the org's enabled bundles and builds the tool array. This set is frozen for the session. Even if an admin enables Jira for Acme mid-conversation, the active session keeps its original tool set (GitHub + Slack).

This is important for LLM consistency. The model receives tool definitions in its context and builds a mental model of what's available. If tools appear or disappear mid-conversation, the model may reference tools that no longer exist or miss tools that just appeared. Freezing the set at session start avoids this class of bugs entirely.

To pick up config changes, the user starts a new session (or in our demo, uses `/org acme` to rebuild the config).

## Token Budget Impact

Each tool definition costs roughly 100-300 tokens depending on parameter complexity. With 30 tools, that's 3,000-9,000 tokens consumed before the user says anything. The bundle system naturally keeps the per-session tool count small:

- 3 bundles with 3 tools each = 9 total tools in the registry
- Per-org sets range from 3-6 tools = 300-1,800 tokens

In production with 20+ bundles, the difference becomes dramatic. An org with 3 integrations gets ~9 tools (~2,000 tokens) instead of 60+ tools (~15,000 tokens). That's context window space reclaimed for actual conversation.

## The Session Builder — `buildSessionConfig()`

This is the key function that wires the three layers together:

```typescript
export function buildSessionConfig(orgId: string): SessionToolConfig {
  const org = getOrg(orgId);

  // Layer 2 → Layer 1: collect tool definitions for enabled bundles
  const activeBundles: string[] = [];
  const tools: ToolDefinition[] = [];
  for (const bundleName of org.enabledBundles) {
    const bundle = BUNDLE_REGISTRY[bundleName];
    if (bundle) {
      activeBundles.push(bundleName);
      tools.push(...bundle.tools);
    }
  }

  // Layer 3: lazy credential loading inside the closure
  const credentialCache: Record<string, BundleCredentials> = {};

  function executeTool(name: string, args: Record<string, string>): string {
    const bundleName = name.slice(0, name.indexOf("."));

    if (!activeBundles.includes(bundleName)) {
      return JSON.stringify({ error: `Bundle not enabled` });
    }

    if (!credentialCache[bundleName]) {
      credentialCache[bundleName] = getCredentials(orgId, bundleName);
    }

    return executeToolImpl(name, args, credentialCache[bundleName]);
  }

  return { orgId, orgName: org.name, activeBundles, tools, executeTool };
}
```

The return type — `SessionToolConfig` — is the same shape the agent expects. It contains `tools` (the definitions to send to the LLM) and `executeTool` (the closure that handles dispatch + credentials). The agent never sees bundles, orgs, or credentials directly. This is the same dependency injection pattern used in [MCP](../mcp/README.md): the agent loop is decoupled from where tools come from.

## Running the Demo

```bash
pnpm dev:tool-bundle
```

The demo starts as Acme Corp with GitHub + Slack (6 tools). Try these flows:

```
[Acme Corp] You: Create a PR for the auth-fix branch
# → calls github.create_pr, lazy-loads acme/github credentials

[Acme Corp] You: Send a message to #deployments saying the PR is ready
# → calls slack.send_message, lazy-loads acme/slack credentials

/org globex
# → switches to Globex Inc: GitHub + Jira (6 tools), Slack disappears

[Globex Inc] You: Create a bug ticket for the login crash
# → calls jira.create_ticket, lazy-loads globex/jira credentials

/org initech
# → switches to Initech Ltd: GitHub only (3 tools)

[Initech Ltd] You: Send a Slack message
# → agent has no Slack tools, responds that integration isn't configured
```

Other commands: `/orgs` (list organizations), `/bundles` (show registry), `/tools` (current tool set), `/reset` (clear history).

## In the Wild: Coding Agent Harnesses

Tool bundling shows up across coding agent harnesses, though each takes a different approach to the same problem: making the right tools available in the right context.

**Claude Code** implements a 5-tier settings hierarchy (Managed > CLI args > Local > Project > User) where array settings — including MCP tool permissions — merge and deduplicate across scopes. Its permission model uses `allow / ask / deny` with glob patterns (`Bash(npm run *)`, `WebFetch(domain:example.com)`), and deny rules are evaluated first. Most notably, Claude Code's **MCP Tool Search** is a unique lazy-loading system: when too many tools would consume more than ~10% of the context window, it builds a lightweight index and loads tool definitions on-demand — conceptually similar to our lazy credential loading, but applied to tool _definitions_ themselves rather than credentials. Enterprise deployments use `managed-settings.json` that cannot be overridden, with `allowManagedMcpServersOnly: true` restricting to admin-approved MCP servers only.

**Roo Code** has the most sophisticated access control among harnesses. Tools are organized into groups (`read`, `edit`, `command`, `mcp`, `browser`), and each mode enables specific groups. Custom modes can restrict tools by file regex — a "docs-writer" mode might allow `edit` only for `\.(md|mdx)$` files. The LLM never sees unauthorized tools; they're filtered from the system prompt rather than just blocked at runtime. This is the closest to our bundle system's approach of only injecting enabled tools.

**OpenCode** implements a 6-level config cascade (the deepest of any harness) with per-agent tool restrictions — a `code-reviewer` agent might have `write: false, edit: false`. It supports wildcard permissions like `"mymcp_*": "ask"` to control all tools from a specific MCP server, and a `.well-known/opencode` endpoint for organizational defaults — a push-based enterprise config similar to our Layer 2 org integrations.

**Codex CLI** takes a different angle with per-server tool filtering: `enabled_tools` (allowlist) and `disabled_tools` (blocklist applied after allowlist). This is a simpler variant of our bundle system — instead of grouping tools into bundles, it filters the flat tool list per MCP server.

**Windsurf (Codeium)** imposes a hard 100-tool budget across all servers, forcing users to actively curate which tools are active. Rather than enabling/disabling entire servers (bundles), it provides per-tool toggles within each server. This is the token budget concern made explicit as a product constraint.

The pattern across all harnesses is consistent: tools are never "all or nothing." Every production system provides at least user vs. project scoping, and the more mature systems (Claude Code, Roo Code, OpenCode) add enterprise-level restrictions. Our three-layer architecture maps to the same tiers: Layer 1 is what the developer deploys (tool definitions), Layer 2 is what the admin configures (org/project enablement), Layer 3 is what the runtime resolves (credentials per session).

## Key Takeaways

1. **Separate existence from availability from authentication.** Three layers, three owners, three change cadences. Mixing them creates a system where every integration change requires a code deploy.

2. **Namespace-prefix tool names.** `github.create_pr` instead of `create_pr`. The prefix prevents collisions and doubles as the credential routing key.

3. **Lazy-load credentials.** Don't fetch tokens until a tool from that bundle is actually called. Reduces attack surface and avoids unnecessary latency from vault/OAuth lookups.

4. **Freeze the tool set per session.** Build the tool array once at session start. The LLM needs a consistent view of available tools throughout the conversation.

5. **The agent loop doesn't change.** Same ReAct loop, same dependency injection interface. Bundle management is a configuration concern, not an agent logic concern.

## Sources & Further Reading

- [Anthropic — Tool Search for Claude](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/tool-search) — Claude's approach to lazy tool loading when tool count exceeds context budget
- [OpenAI — Allowed Tools](https://platform.openai.com/docs/guides/function-calling) — Per-turn tool restriction via `allowed_tools` parameter
- [Google Gemini — Function Calling Config](https://ai.google.dev/gemini-api/docs/function-calling) — `allowed_function_names` for per-request tool subset restriction
- [Claude Code — Settings & Permissions](https://docs.anthropic.com/en/docs/claude-code/settings) — 5-tier settings hierarchy with MCP tool management
- [Roo Code — Custom Modes](https://docs.roocode.com/features/custom-modes) — Mode-based tool group configuration
- [OpenCode — Configuration](https://opencode.ai/docs/configuration) — 6-level config cascade with per-agent tool restrictions
- [MCP Specification](https://modelcontextprotocol.io/) — The protocol layer that tool bundles build on top of
