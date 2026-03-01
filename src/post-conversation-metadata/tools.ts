import type { ToolDefinition } from "../shared/types.js";

// ─── Agent Mode ──────────────────────────────────────────────────────────────

export type AgentMode = "with-metadata" | "no-metadata";

// ─── Mock Data ───────────────────────────────────────────────────────────────

const ACCOUNTS = [
  {
    id: "ACC-1001",
    name: "Acme Corp",
    email: "admin@acme.io",
    plan: "Business",
    status: "active",
    createdAt: "2024-03-15",
    users: 47,
    region: "us-east-1",
  },
  {
    id: "ACC-1002",
    name: "StartupXYZ",
    email: "cto@startupxyz.dev",
    plan: "Starter",
    status: "active",
    createdAt: "2025-11-02",
    users: 5,
    region: "eu-west-1",
  },
  {
    id: "ACC-1003",
    name: "MegaFinance Ltd",
    email: "it@megafinance.com",
    plan: "Enterprise",
    status: "suspended",
    createdAt: "2023-06-20",
    users: 312,
    region: "us-west-2",
  },
];

const SUBSCRIPTIONS = [
  {
    accountId: "ACC-1001",
    plan: "Business",
    monthlyPrice: 299,
    billingCycle: "monthly",
    nextBillingDate: "2026-04-01",
    paymentMethod: "Visa ending 4242",
    autoRenew: true,
  },
  {
    accountId: "ACC-1002",
    plan: "Starter",
    monthlyPrice: 29,
    billingCycle: "monthly",
    nextBillingDate: "2026-03-15",
    paymentMethod: "PayPal (cto@startupxyz.dev)",
    autoRenew: true,
  },
  {
    accountId: "ACC-1003",
    plan: "Enterprise",
    monthlyPrice: 1499,
    billingCycle: "annual",
    nextBillingDate: "2026-06-20",
    paymentMethod: "Invoice (NET-30)",
    autoRenew: false,
  },
];

const KNOWN_ISSUES = [
  {
    id: "INC-401",
    title: "Intermittent 502 errors on API Gateway",
    status: "investigating",
    severity: "high",
    affectedServices: ["API Gateway", "Load Balancer"],
    startedAt: "2026-02-28T14:30:00Z",
    updatedAt: "2026-03-01T09:15:00Z",
  },
  {
    id: "INC-399",
    title: "Dashboard charts not loading for EU region",
    status: "identified",
    severity: "medium",
    affectedServices: ["Dashboard", "Metrics API"],
    startedAt: "2026-02-27T08:00:00Z",
    updatedAt: "2026-02-28T16:45:00Z",
  },
  {
    id: "INC-395",
    title: "Delayed email notifications",
    status: "monitoring",
    severity: "low",
    affectedServices: ["Notification Service"],
    startedAt: "2026-02-25T10:00:00Z",
    updatedAt: "2026-02-27T12:00:00Z",
  },
  {
    id: "INC-390",
    title: "SSO login failures with SAML providers",
    status: "resolved",
    severity: "high",
    affectedServices: ["Authentication", "SSO Gateway"],
    startedAt: "2026-02-20T06:00:00Z",
    updatedAt: "2026-02-22T18:00:00Z",
    resolvedAt: "2026-02-22T18:00:00Z",
  },
];

const DOCS = [
  {
    id: "DOC-001",
    title: "Getting Started with CloudStack",
    category: "onboarding",
    summary:
      "Step-by-step guide to set up your CloudStack account, create your first project, and deploy a sample app.",
    url: "https://docs.cloudstack.io/getting-started",
  },
  {
    id: "DOC-002",
    title: "Setting Up SSO with SAML 2.0",
    category: "authentication",
    summary:
      "Configure Single Sign-On using SAML 2.0 with providers like Okta, Azure AD, or OneLogin. Includes XML metadata setup and attribute mapping.",
    url: "https://docs.cloudstack.io/sso-saml",
  },
  {
    id: "DOC-003",
    title: "Billing & Invoice Management",
    category: "billing",
    summary:
      "Understand your bill, download invoices, update payment methods, and manage subscription tiers. Covers proration for mid-cycle upgrades.",
    url: "https://docs.cloudstack.io/billing",
  },
  {
    id: "DOC-004",
    title: "API Rate Limits & Throttling",
    category: "api",
    summary:
      "Rate limit tiers per plan (Starter: 100 req/min, Business: 1000 req/min, Enterprise: 10000 req/min). Includes retry-after header behavior and backoff strategies.",
    url: "https://docs.cloudstack.io/rate-limits",
  },
  {
    id: "DOC-005",
    title: "Upgrading Your Plan",
    category: "billing",
    summary:
      "How to upgrade from Starter to Business or Enterprise. Covers proration, feature unlocks, and team seat changes.",
    url: "https://docs.cloudstack.io/upgrade",
  },
  {
    id: "DOC-006",
    title: "Troubleshooting Deployment Failures",
    category: "technical",
    summary:
      "Common deployment error codes (E001-E050), root causes, and resolution steps. Includes build log analysis and rollback procedures.",
    url: "https://docs.cloudstack.io/troubleshooting-deploys",
  },
];

// ─── Tool Definitions ────────────────────────────────────────────────────────

const lookupAccountTool: ToolDefinition = {
  type: "function",
  function: {
    name: "lookup_account",
    description:
      "Look up a CloudStack customer account by account ID, company name, or email address. Returns account details including plan, status, and region.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Account ID (e.g. ACC-1001), company name, or email address to search for",
        },
      },
      required: ["query"],
    },
  },
};

const checkSubscriptionTool: ToolDefinition = {
  type: "function",
  function: {
    name: "check_subscription",
    description:
      "Check the subscription and billing details for a CloudStack account. Returns plan, pricing, payment method, and next billing date.",
    parameters: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The account ID (e.g. ACC-1001) to check subscription for",
        },
      },
      required: ["account_id"],
    },
  },
};

const listKnownIssuesTool: ToolDefinition = {
  type: "function",
  function: {
    name: "list_known_issues",
    description:
      "List current known issues and incidents affecting CloudStack services. Optionally filter by severity level.",
    parameters: {
      type: "object",
      properties: {
        severity: {
          type: "string",
          description: "Filter by severity: 'high', 'medium', or 'low'. Omit to list all.",
          enum: ["high", "medium", "low"],
        },
      },
      required: [],
    },
  },
};

const searchDocsTool: ToolDefinition = {
  type: "function",
  function: {
    name: "search_docs",
    description:
      "Search CloudStack documentation by keyword. Returns matching articles with titles, summaries, and links.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g. 'SSO setup', 'rate limits', 'billing')",
        },
      },
      required: ["query"],
    },
  },
};

// ─── Tool Implementations ────────────────────────────────────────────────────

function lookupAccount(args: { query: string }): string {
  const q = args.query.toLowerCase();
  const account = ACCOUNTS.find(
    (a) =>
      a.id.toLowerCase() === q ||
      a.name.toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q),
  );

  if (!account) {
    return JSON.stringify({ found: false, message: `No account found matching "${args.query}"` });
  }
  return JSON.stringify({ found: true, account });
}

function checkSubscription(args: { account_id: string }): string {
  const sub = SUBSCRIPTIONS.find((s) => s.accountId === args.account_id);
  if (!sub) {
    return JSON.stringify({
      found: false,
      message: `No subscription found for account ${args.account_id}`,
    });
  }
  return JSON.stringify({ found: true, subscription: sub });
}

function listKnownIssues(args: { severity?: string }): string {
  let issues = KNOWN_ISSUES;
  if (args.severity) {
    issues = issues.filter((i) => i.severity === args.severity);
  }
  return JSON.stringify({ issues, total: issues.length });
}

function searchDocs(args: { query: string }): string {
  const q = args.query.toLowerCase();
  const matches = DOCS.filter(
    (d) =>
      d.title.toLowerCase().includes(q) ||
      d.summary.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q),
  );
  return JSON.stringify({ results: matches, total: matches.length });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "lookup_account":
      return lookupAccount(args as { query: string });
    case "check_subscription":
      return checkSubscription(args as { account_id: string });
    case "list_known_issues":
      return listKnownIssues(args as { severity?: string });
    case "search_docs":
      return searchDocs(args as { query: string });
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const tools: ToolDefinition[] = [
  lookupAccountTool,
  checkSubscriptionTool,
  listKnownIssuesTool,
  searchDocsTool,
];
