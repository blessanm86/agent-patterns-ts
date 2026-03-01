import type * as readline from "readline";

// ─── Risk Levels ─────────────────────────────────────────────────────────────
//
// Every tool is assigned a risk level. The level determines whether the agent
// can auto-execute or must pause for human approval.

export type RiskLevel = "read-only" | "low" | "medium" | "high" | "critical";

// ─── Approval Modes ──────────────────────────────────────────────────────────
//
// Three presets that slide the autonomy dial:
//
//   auto     — agent runs freely; only critical actions need approval
//   balanced — default; high + critical actions need approval
//   strict   — everything except reads needs approval

export type ApprovalMode = "auto" | "balanced" | "strict";

// ─── Tool → Risk Mapping ─────────────────────────────────────────────────────

export const TOOL_RISK_MAP: Record<string, RiskLevel> = {
  list_tasks: "read-only",
  get_task_detail: "read-only",
  create_task: "low",
  update_task_status: "medium",
  reassign_task: "medium",
  delete_task: "high",
  bulk_delete_tasks: "critical",
};

// ─── Approval Decision Logic ─────────────────────────────────────────────────

const GATED_LEVELS: Record<ApprovalMode, Set<RiskLevel>> = {
  auto: new Set(["critical"]),
  balanced: new Set(["high", "critical"]),
  strict: new Set(["low", "medium", "high", "critical"]),
};

export function needsApproval(toolName: string, mode: ApprovalMode): boolean {
  const risk = TOOL_RISK_MAP[toolName] ?? "high"; // unknown tools default to high
  return GATED_LEVELS[mode].has(risk);
}

// ─── Human-Readable Action Description ───────────────────────────────────────

export function describeAction(toolName: string, args: Record<string, string>): string {
  switch (toolName) {
    case "list_tasks":
      return args.status ? `List tasks with status "${args.status}"` : "List all tasks";
    case "get_task_detail":
      return `View details for task ${args.task_id}`;
    case "create_task":
      return `Create task: "${args.title}"`;
    case "update_task_status":
      return `Change task ${args.task_id} status to "${args.new_status}"`;
    case "reassign_task":
      return `Reassign task ${args.task_id} to ${args.new_assignee}`;
    case "delete_task":
      return `Delete task ${args.task_id}`;
    case "bulk_delete_tasks":
      return `Bulk delete all tasks with status "${args.status}"`;
    default:
      return `${toolName}(${JSON.stringify(args)})`;
  }
}

// ─── Risk Level Display ──────────────────────────────────────────────────────

const RISK_COLORS: Record<RiskLevel, string> = {
  "read-only": "\x1b[32m", // green
  low: "\x1b[36m", // cyan
  medium: "\x1b[33m", // yellow
  high: "\x1b[31m", // red
  critical: "\x1b[35m", // magenta
};

const RESET = "\x1b[0m";

export function formatRisk(risk: RiskLevel): string {
  return `${RISK_COLORS[risk]}${risk.toUpperCase()}${RESET}`;
}

// ─── Approval Request ────────────────────────────────────────────────────────
//
// Pauses execution and prompts the user inline. Returns their decision:
//   approved — execute as planned
//   denied   — return denial as tool result so the model can adapt
//   modified — user provided new args (for edit-before-continue)

export type ApprovalDecision = "approved" | "denied" | "modified";

export interface ApprovalResult {
  decision: ApprovalDecision;
  reason?: string;
  modifiedArgs?: Record<string, string>;
}

export interface ApprovalRequest {
  toolName: string;
  args: Record<string, string>;
  risk: RiskLevel;
  description: string;
}

export function requestApproval(
  request: ApprovalRequest,
  rl: readline.Interface,
): Promise<ApprovalResult> {
  return new Promise((resolve) => {
    const { toolName, risk, description } = request;

    console.log("\n  ┌──────────────────────────────────────────────────");
    console.log(`  │  🔒 APPROVAL REQUIRED`);
    console.log(`  │  Tool: ${toolName}  |  Risk: ${formatRisk(risk)}`);
    console.log(`  │  Action: ${description}`);
    console.log("  │");
    console.log("  │  [y] Approve  [n] Deny  [m] Modify args");
    console.log("  └──────────────────────────────────────────────────");

    process.stdout.write("  Decision: ");
    rl.once("line", (input) => {
      const choice = input.trim().toLowerCase();

      if (choice === "y" || choice === "yes") {
        console.log("  ✅ Approved");
        resolve({ decision: "approved" });
      } else if (choice === "m" || choice === "modify") {
        process.stdout.write("  New args (JSON): ");
        rl.once("line", (argsInput) => {
          try {
            const modifiedArgs = JSON.parse(argsInput.trim());
            console.log("  ✏️  Modified and approved");
            resolve({ decision: "modified", modifiedArgs });
          } catch {
            console.log("  ⚠️  Invalid JSON — denying action");
            resolve({ decision: "denied", reason: "Invalid modified args" });
          }
        });
      } else {
        // Anything else (including 'n') is a denial
        process.stdout.write("  Reason (optional): ");
        rl.once("line", (reasonInput) => {
          const reason = reasonInput.trim() || "User denied the action";
          console.log(`  ❌ Denied: ${reason}`);
          resolve({ decision: "denied", reason });
        });
      }
    });
  });
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────
//
// Immutable log of every approval decision. Useful for compliance, debugging,
// and showing the user what happened at the end of a session.

export interface AuditEntry {
  timestamp: Date;
  toolName: string;
  args: Record<string, string>;
  risk: RiskLevel;
  decision: ApprovalDecision | "auto-approved";
  reason?: string;
}

export class AuditTrail {
  private entries: AuditEntry[] = [];

  log(entry: Omit<AuditEntry, "timestamp">) {
    this.entries.push({ ...entry, timestamp: new Date() });
  }

  getEntries(): ReadonlyArray<AuditEntry> {
    return this.entries;
  }

  getSummary(): {
    total: number;
    autoApproved: number;
    humanApproved: number;
    denied: number;
    modified: number;
  } {
    let autoApproved = 0;
    let humanApproved = 0;
    let denied = 0;
    let modified = 0;

    for (const entry of this.entries) {
      switch (entry.decision) {
        case "auto-approved":
          autoApproved++;
          break;
        case "approved":
          humanApproved++;
          break;
        case "denied":
          denied++;
          break;
        case "modified":
          modified++;
          break;
      }
    }

    return { total: this.entries.length, autoApproved, humanApproved, denied, modified };
  }

  toDisplayLines(): string[] {
    if (this.entries.length === 0) return ["  No actions recorded yet."];

    const lines: string[] = [];
    for (const entry of this.entries) {
      const time = entry.timestamp.toLocaleTimeString();
      const risk = formatRisk(entry.risk);
      const decision =
        entry.decision === "auto-approved"
          ? "⚡ auto"
          : entry.decision === "approved"
            ? "✅ yes"
            : entry.decision === "denied"
              ? "❌ no"
              : "✏️  mod";
      lines.push(
        `  ${time}  ${decision}  [${risk}]  ${entry.toolName}(${JSON.stringify(entry.args)})`,
      );
      if (entry.reason) {
        lines.push(`           └─ ${entry.reason}`);
      }
    }
    return lines;
  }

  clear() {
    this.entries = [];
  }
}
