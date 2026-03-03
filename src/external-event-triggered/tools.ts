import type { ToolDefinition } from "./types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_pr_diff",
      description:
        "Get the diff for a pull request. Returns the changed files with line-by-line additions and deletions.",
      parameters: {
        type: "object",
        properties: {
          pr_number: {
            type: "string",
            description: "The pull request number",
          },
        },
        required: ["pr_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_build_logs",
      description:
        "Fetch build/CI logs for a specific run. Returns the full log output including test results and error messages.",
      parameters: {
        type: "object",
        properties: {
          run_id: {
            type: "string",
            description: "The CI run ID",
          },
        },
        required: ["run_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_reviewers",
      description:
        "List suggested reviewers for a pull request based on file ownership and expertise areas.",
      parameters: {
        type: "object",
        properties: {
          pr_number: {
            type: "string",
            description: "The pull request number",
          },
        },
        required: ["pr_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_file_content",
      description:
        "Read the contents of a file from the repository at the latest commit on the PR branch.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to repo root (e.g. src/auth/login.ts)",
          },
          pr_number: {
            type: "string",
            description: "The pull request number (to read from the PR branch)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "post_comment",
      description:
        "Post a comment on a pull request or issue. This is how the agent responds back to the platform — results go via API, not HTTP response.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "Where to post: 'pr-42', 'issue-7', etc.",
          },
          body: {
            type: "string",
            description: "The markdown comment body to post",
          },
        },
        required: ["target", "body"],
      },
    },
  },
];

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_DIFFS: Record<string, string> = {
  "42": `diff --git a/src/auth/login.ts b/src/auth/login.ts
index 3a1b2c4..8f9e0d1 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -15,8 +15,21 @@ export async function authenticateUser(email: string, password: string) {
   const user = await db.users.findByEmail(email);
   if (!user) throw new AuthError("User not found");

-  const valid = await bcrypt.compare(password, user.passwordHash);
-  if (!valid) throw new AuthError("Invalid password");
+  // Rate limit: max 5 failed attempts per 15 minutes
+  const attempts = await db.loginAttempts.count({
+    email,
+    since: Date.now() - 15 * 60 * 1000,
+  });
+  if (attempts >= 5) {
+    throw new AuthError("Too many login attempts. Try again in 15 minutes.");
+  }
+
+  const valid = await bcrypt.compare(password, user.passwordHash);
+  if (!valid) {
+    await db.loginAttempts.record({ email, timestamp: Date.now() });
+    throw new AuthError("Invalid password");
+  }
+
+  // Clear attempts on successful login
+  await db.loginAttempts.clear({ email });

   return generateSession(user);
 }

diff --git a/src/auth/login.test.ts b/src/auth/login.test.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/auth/login.test.ts
+++ b/src/auth/login.test.ts
@@ -42,4 +42,28 @@ describe("authenticateUser", () => {
     const result = await authenticateUser("test@co.com", "wrong");
     expect(result).rejects.toThrow("Invalid password");
   });
+
+  describe("rate limiting", () => {
+    it("blocks after 5 failed attempts", async () => {
+      for (let i = 0; i < 5; i++) {
+        await authenticateUser("test@co.com", "wrong").catch(() => {});
+      }
+      await expect(authenticateUser("test@co.com", "wrong"))
+        .rejects.toThrow("Too many login attempts");
+    });
+
+    it("resets after successful login", async () => {
+      for (let i = 0; i < 3; i++) {
+        await authenticateUser("test@co.com", "wrong").catch(() => {});
+      }
+      await authenticateUser("test@co.com", "correct-password");
+      // Should not throw — counter was reset
+      await expect(authenticateUser("test@co.com", "wrong"))
+        .rejects.toThrow("Invalid password");
+    });
+  });
 });`,

  default: `diff --git a/README.md b/README.md
index 1234567..abcdef0 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,5 @@
 # Project
-Old description
+New description with more detail
+
+## Getting Started
+Run \`npm install\` then \`npm start\``,
};

const MOCK_BUILD_LOGS: Record<string, string> = {
  "98765": `=== CI Run #98765 — PR #42 ===
Node.js 20.11.0 | pnpm 8.15.4

> Installing dependencies...
  added 847 packages in 12s

> Running lint...
  ✓ 0 errors, 0 warnings

> Running type check...
  ✓ No type errors

> Running tests...
  PASS  src/auth/login.test.ts
    authenticateUser
      ✓ authenticates valid user (23ms)
      ✓ rejects unknown email (5ms)
      ✓ rejects wrong password (8ms)
      rate limiting
        ✗ blocks after 5 failed attempts (45ms)

          Expected: "Too many login attempts"
          Received: "Invalid password"

          The rate limiter count() query uses \`since: Date.now()\` but the
          test runs all 5 attempts within the same millisecond. The count
          query should use \`since: Date.now() - 15 * 60 * 1000\` (which
          it does) but the mock database isn't persisting attempts between
          calls because \`beforeEach\` clears the DB.

        ✓ resets after successful login (12ms)

  Tests:  1 failed, 3 passed, 4 total
  Time:   1.234s

BUILD FAILED — 1 test failure`,

  default: `=== CI Run — Default ===
> Running tests...
  PASS  all tests passed
  Tests: 12 passed, 12 total
BUILD SUCCEEDED`,
};

const MOCK_REVIEWERS = [
  {
    username: "alice-sec",
    name: "Alice Chen",
    expertise: ["authentication", "security", "cryptography"],
    recentReviews: 12,
  },
  {
    username: "bob-backend",
    name: "Bob Martinez",
    expertise: ["api", "database", "performance"],
    recentReviews: 8,
  },
  {
    username: "carol-test",
    name: "Carol Kim",
    expertise: ["testing", "ci-cd", "quality"],
    recentReviews: 15,
  },
  {
    username: "dave-fullstack",
    name: "Dave Patel",
    expertise: ["frontend", "backend", "auth"],
    recentReviews: 6,
  },
];

const MOCK_FILES: Record<string, string> = {
  "src/auth/login.ts": `import bcrypt from "bcrypt";
import { db } from "../db/client";
import { AuthError } from "./errors";
import { generateSession } from "./session";

export async function authenticateUser(email: string, password: string) {
  const user = await db.users.findByEmail(email);
  if (!user) throw new AuthError("User not found");

  // Rate limit: max 5 failed attempts per 15 minutes
  const attempts = await db.loginAttempts.count({
    email,
    since: Date.now() - 15 * 60 * 1000,
  });
  if (attempts >= 5) {
    throw new AuthError("Too many login attempts. Try again in 15 minutes.");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await db.loginAttempts.record({ email, timestamp: Date.now() });
    throw new AuthError("Invalid password");
  }

  await db.loginAttempts.clear({ email });
  return generateSession(user);
}`,
  "src/auth/login.test.ts": `import { authenticateUser } from "./login";
import { db } from "../db/client";

beforeEach(() => {
  db.reset(); // Clears all mock data between tests
});

describe("authenticateUser", () => {
  it("authenticates valid user", async () => {
    db.users.seed({ email: "test@co.com", password: "correct-password" });
    const session = await authenticateUser("test@co.com", "correct-password");
    expect(session.token).toBeDefined();
  });
});`,
};

// ─── Tool Implementations ────────────────────────────────────────────────────

function getPrDiff(args: { pr_number: string }): string {
  const diff = MOCK_DIFFS[args.pr_number] ?? MOCK_DIFFS.default;
  return JSON.stringify({
    pr_number: args.pr_number,
    files_changed: 2,
    additions: 25,
    deletions: 3,
    diff,
  });
}

function getBuildLogs(args: { run_id: string }): string {
  const logs = MOCK_BUILD_LOGS[args.run_id] ?? MOCK_BUILD_LOGS.default;
  return JSON.stringify({
    run_id: args.run_id,
    status: args.run_id === "98765" ? "failure" : "success",
    logs,
  });
}

function listReviewers(args: { pr_number: string }): string {
  // Score reviewers based on file overlap — in reality this would check
  // CODEOWNERS and git blame data
  const scored = MOCK_REVIEWERS.map((r) => ({
    ...r,
    score: r.expertise.includes("authentication") || r.expertise.includes("security") ? 0.95 : 0.6,
  })).sort((a, b) => b.score - a.score);

  return JSON.stringify({
    pr_number: args.pr_number,
    suggested_reviewers: scored.slice(0, 3),
  });
}

function getFileContent(args: { path: string; pr_number?: string }): string {
  const content = MOCK_FILES[args.path];
  if (!content) {
    return JSON.stringify({ error: `File not found: ${args.path}` });
  }
  return JSON.stringify({
    path: args.path,
    content,
    lines: content.split("\n").length,
  });
}

function postComment(args: { target: string; body: string }): string {
  // In production this would call the GitHub API. Here we just confirm
  // the post and return the comment ID.
  const commentId = Math.floor(Math.random() * 900000) + 100000;
  return JSON.stringify({
    success: true,
    comment_id: commentId,
    target: args.target,
    body_length: args.body.length,
    message: `Comment posted to ${args.target}`,
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "get_pr_diff":
      return getPrDiff(args as Parameters<typeof getPrDiff>[0]);
    case "get_build_logs":
      return getBuildLogs(args as Parameters<typeof getBuildLogs>[0]);
    case "list_reviewers":
      return listReviewers(args as Parameters<typeof listReviewers>[0]);
    case "get_file_content":
      return getFileContent(args as Parameters<typeof getFileContent>[0]);
    case "post_comment":
      return postComment(args as Parameters<typeof postComment>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
