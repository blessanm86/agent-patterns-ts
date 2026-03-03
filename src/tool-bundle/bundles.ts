// ─── Tool Bundle Registry & Session Builder ─────────────────────────────────
//
// The core concept: three layers wired together at session start.
//
//   Layer 1: BUNDLE_REGISTRY  — static code, defines which tools exist per bundle
//   Layer 2: Org integrations — which bundles each org has enabled (data.ts)
//   Layer 3: Credentials      — lazy-loaded per tool call, not at session start
//
// buildSessionConfig() is the key function — it reads layers 1 & 2 eagerly
// (to build the tool set), but defers layer 3 until a tool is actually called.

import type { ToolDefinition } from "../shared/types.js";
import { getOrg, getCredentials, type BundleCredentials } from "./data.js";
import { executeToolImpl } from "./tools.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolBundle {
  name: string;
  description: string;
  tools: ToolDefinition[];
}

export interface SessionToolConfig {
  orgId: string;
  orgName: string;
  activeBundles: string[];
  tools: ToolDefinition[];
  executeTool: (name: string, args: Record<string, string>) => string;
}

// ─── Layer 1: Bundle Registry ────────────────────────────────────────────────
//
// Each bundle groups related tools under a namespace prefix.
// The prefix serves two purposes:
//   1. Collision avoidance — github.list_issues vs jira.list_issues
//   2. Credential routing — the prefix tells executeTool which bundle's creds to load

export const BUNDLE_REGISTRY: Record<string, ToolBundle> = {
  github: {
    name: "github",
    description: "GitHub integration — PRs, issues, CI status",
    tools: [
      {
        type: "function",
        function: {
          name: "github.create_pr",
          description: "Create a pull request on GitHub. Returns the PR number, URL, and status.",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Title of the pull request",
              },
              branch: {
                type: "string",
                description: "Source branch name to create the PR from (e.g. 'feature/auth-fix')",
              },
            },
            required: ["title", "branch"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "github.list_issues",
          description:
            "List open issues on GitHub, optionally filtered by label. Returns issue number, title, label, and state.",
          parameters: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description:
                  "Filter by label (e.g. 'bug', 'enhancement', 'docs'). Omit for all issues.",
              },
            },
            required: [],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "github.check_ci_status",
          description:
            "Check CI/CD pipeline status for a branch. Returns check names and pass/fail status.",
          parameters: {
            type: "object",
            properties: {
              branch: {
                type: "string",
                description: "Branch name to check (defaults to 'main')",
              },
            },
            required: [],
          },
        },
      },
    ],
  },

  slack: {
    name: "slack",
    description: "Slack integration — messages, channels, threads",
    tools: [
      {
        type: "function",
        function: {
          name: "slack.send_message",
          description:
            "Send a message to a Slack channel. Returns delivery confirmation with timestamp.",
          parameters: {
            type: "object",
            properties: {
              channel: {
                type: "string",
                description: "Channel name including # (e.g. '#deployments', '#engineering')",
              },
              message: {
                type: "string",
                description: "Message text to send",
              },
            },
            required: ["channel", "message"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "slack.list_channels",
          description: "List available Slack channels with member counts and topics.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "slack.get_thread",
          description: "Get messages from a Slack thread. Returns the conversation history.",
          parameters: {
            type: "object",
            properties: {
              channel: {
                type: "string",
                description: "Channel name where the thread is",
              },
              thread_id: {
                type: "string",
                description: "Thread timestamp ID",
              },
            },
            required: ["channel"],
          },
        },
      },
    ],
  },

  jira: {
    name: "jira",
    description: "Jira integration — tickets, search, updates",
    tools: [
      {
        type: "function",
        function: {
          name: "jira.create_ticket",
          description: "Create a new Jira ticket. Returns the ticket key, URL, and status.",
          parameters: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description: "Ticket summary / title",
              },
              type: {
                type: "string",
                description: "Ticket type",
                enum: ["bug", "task", "story", "epic"],
              },
              priority: {
                type: "string",
                description: "Priority level",
                enum: ["critical", "high", "medium", "low"],
              },
            },
            required: ["summary"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "jira.update_ticket",
          description:
            "Update fields on an existing Jira ticket. Specify only the fields to change.",
          parameters: {
            type: "object",
            properties: {
              ticket_key: {
                type: "string",
                description: "Ticket key (e.g. 'PROJ-195')",
              },
              status: {
                type: "string",
                description: "New status (e.g. 'In Progress', 'Done')",
              },
              assignee: {
                type: "string",
                description: "Assignee username",
              },
              priority: {
                type: "string",
                description: "New priority level",
                enum: ["critical", "high", "medium", "low"],
              },
            },
            required: ["ticket_key"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "jira.search_tickets",
          description:
            "Search Jira tickets by keyword, type, or priority. Returns matching tickets with key, summary, type, status, and priority.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Search term — matches summary text, type (bug/task/story), or priority (critical/high/medium/low)",
              },
            },
            required: ["query"],
          },
        },
      },
    ],
  },
};

// ─── Session Builder ─────────────────────────────────────────────────────────
//
// This is the key function. It wires the three layers together:
//
//   1. Look up which bundles the org has enabled  (Layer 2 — eager)
//   2. Collect tool definitions from those bundles (Layer 1 — eager)
//   3. Create an executeTool closure that loads    (Layer 3 — lazy)
//      credentials only when a tool is actually called

export function buildSessionConfig(orgId: string): SessionToolConfig {
  const maybeOrg = getOrg(orgId);
  if (!maybeOrg) {
    throw new Error(`Unknown org: ${orgId}`);
  }
  const org = maybeOrg;

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
  // Credentials are cached per session — loaded once per bundle, not per call
  const credentialCache: Record<string, BundleCredentials> = {};

  function executeTool(name: string, args: Record<string, string>): string {
    // Extract bundle name from namespace prefix (e.g. "github.create_pr" → "github")
    const dotIndex = name.indexOf(".");
    if (dotIndex === -1) {
      return JSON.stringify({ error: `Invalid tool name (no namespace): ${name}` });
    }
    const bundleName = name.slice(0, dotIndex);

    // Verify the bundle is enabled for this org
    if (!activeBundles.includes(bundleName)) {
      return JSON.stringify({
        error: `Bundle '${bundleName}' is not enabled for org '${org.name}'`,
      });
    }

    // Lazy-load credentials (cached after first load)
    if (!credentialCache[bundleName]) {
      const creds = getCredentials(orgId, bundleName);
      if (!creds) {
        return JSON.stringify({
          error: `No credentials found for ${orgId}/${bundleName}`,
        });
      }
      credentialCache[bundleName] = creds;
    }

    return executeToolImpl(name, args, credentialCache[bundleName]);
  }

  return { orgId, orgName: org.name, activeBundles, tools, executeTool };
}
