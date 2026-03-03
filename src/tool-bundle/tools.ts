// ─── Tool Implementations (Simulated API Responses) ─────────────────────────
//
// Each tool receives its arguments + injected credentials.
// The credentials prove the tool bundle system wired the right org context.
// All responses are simulated — no real API calls.

import type { BundleCredentials } from "./data.js";

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export function executeToolImpl(
  name: string,
  args: Record<string, string>,
  credentials: BundleCredentials,
): string {
  switch (name) {
    // ── GitHub ──────────────────────────────────────────────────────────────
    case "github.create_pr":
      return githubCreatePr(args, credentials);
    case "github.list_issues":
      return githubListIssues(args, credentials);
    case "github.check_ci_status":
      return githubCheckCiStatus(args, credentials);

    // ── Slack ───────────────────────────────────────────────────────────────
    case "slack.send_message":
      return slackSendMessage(args, credentials);
    case "slack.list_channels":
      return slackListChannels(args, credentials);
    case "slack.get_thread":
      return slackGetThread(args, credentials);

    // ── Jira ────────────────────────────────────────────────────────────────
    case "jira.create_ticket":
      return jiraCreateTicket(args, credentials);
    case "jira.update_ticket":
      return jiraUpdateTicket(args, credentials);
    case "jira.search_tickets":
      return jiraSearchTickets(args, credentials);

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── GitHub Tools ────────────────────────────────────────────────────────────

function githubCreatePr(args: Record<string, string>, creds: BundleCredentials): string {
  return JSON.stringify({
    authenticatedAs: creds.org,
    pr: {
      number: 42,
      title: args.title || "Untitled PR",
      branch: args.branch || "feature-branch",
      status: "open",
      url: `https://github.com/${creds.org}/repo/pull/42`,
    },
  });
}

function githubListIssues(args: Record<string, string>, creds: BundleCredentials): string {
  const label = args.label || "all";
  return JSON.stringify({
    authenticatedAs: creds.org,
    issues: [
      { number: 101, title: "Fix login timeout", label: "bug", state: "open" },
      {
        number: 98,
        title: "Add dark mode support",
        label: "enhancement",
        state: "open",
      },
      {
        number: 95,
        title: "Update API documentation",
        label: "docs",
        state: "open",
      },
    ].filter((i) => label === "all" || i.label === label),
  });
}

function githubCheckCiStatus(args: Record<string, string>, creds: BundleCredentials): string {
  return JSON.stringify({
    authenticatedAs: creds.org,
    ci: {
      branch: args.branch || "main",
      status: "passing",
      checks: [
        { name: "lint", status: "passed" },
        { name: "test", status: "passed" },
        { name: "build", status: "passed" },
      ],
      lastRun: "2 minutes ago",
    },
  });
}

// ─── Slack Tools ─────────────────────────────────────────────────────────────

function slackSendMessage(args: Record<string, string>, creds: BundleCredentials): string {
  return JSON.stringify({
    authenticatedAs: creds.workspace,
    message: {
      channel: args.channel || "#general",
      text: args.message || "(empty message)",
      timestamp: "1709500000.000100",
      delivered: true,
    },
  });
}

function slackListChannels(_args: Record<string, string>, creds: BundleCredentials): string {
  return JSON.stringify({
    authenticatedAs: creds.workspace,
    channels: [
      { name: "#general", members: 45, topic: "Company-wide updates" },
      { name: "#engineering", members: 22, topic: "Dev discussions" },
      { name: "#deployments", members: 18, topic: "CI/CD notifications" },
      { name: "#incidents", members: 30, topic: "On-call and incidents" },
    ],
  });
}

function slackGetThread(args: Record<string, string>, creds: BundleCredentials): string {
  return JSON.stringify({
    authenticatedAs: creds.workspace,
    thread: {
      channel: args.channel || "#engineering",
      threadId: args.thread_id || "1709500000.000100",
      messages: [
        { author: "alice", text: "Deploy to staging looks good" },
        { author: "bob", text: "LGTM, merging now" },
        { author: "ci-bot", text: "Build #847 passed all checks" },
      ],
    },
  });
}

// ─── Jira Tools ──────────────────────────────────────────────────────────────

function jiraCreateTicket(args: Record<string, string>, creds: BundleCredentials): string {
  return JSON.stringify({
    authenticatedAs: creds.site,
    ticket: {
      key: "PROJ-201",
      summary: args.summary || "Untitled ticket",
      type: args.type || "task",
      priority: args.priority || "medium",
      status: "To Do",
      url: `https://${creds.site}/browse/PROJ-201`,
    },
  });
}

function jiraUpdateTicket(args: Record<string, string>, creds: BundleCredentials): string {
  return JSON.stringify({
    authenticatedAs: creds.site,
    updated: {
      key: args.ticket_key || "PROJ-100",
      fields: {
        ...(args.status ? { status: args.status } : {}),
        ...(args.assignee ? { assignee: args.assignee } : {}),
        ...(args.priority ? { priority: args.priority } : {}),
      },
      success: true,
    },
  });
}

function jiraSearchTickets(args: Record<string, string>, creds: BundleCredentials): string {
  const query = (args.query || "").toLowerCase();
  const tickets = [
    {
      key: "PROJ-195",
      summary: "Login page crashes on mobile",
      type: "bug",
      status: "In Progress",
      priority: "high",
    },
    {
      key: "PROJ-190",
      summary: "Add SSO support",
      type: "story",
      status: "To Do",
      priority: "medium",
    },
    {
      key: "PROJ-188",
      summary: "Database migration script timeout",
      type: "bug",
      status: "Open",
      priority: "critical",
    },
  ];
  return JSON.stringify({
    authenticatedAs: creds.site,
    results: query
      ? tickets.filter(
          (t) =>
            t.summary.toLowerCase().includes(query) || t.type === query || t.priority === query,
        )
      : tickets,
  });
}
