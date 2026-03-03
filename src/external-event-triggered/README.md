# When Webhooks Knock — Event-Triggered Agents

[Agent Patterns — TypeScript](../../README.md)

> **Previous concept:** [Streaming Responses](../streaming/README.md) — HTTP server with SSE and browser UI. This concept moves beyond chat interfaces to agents triggered by external platform events, adding webhook security, queue serialization, and keep-alive patterns.

---

Chat UIs are just one entry point for agents. In production, some of the most valuable agents never see a chat bubble — they respond to GitHub webhooks, Slack events, Linear updates, and Stripe notifications. The engineering challenges are fundamentally different from a chat endpoint:

- **Strict timeout contracts** — Slack requires a response within 3 seconds. GitHub expects 10 seconds. Miss the deadline and the platform retries, creating duplicate processing.
- **Webhook security** — HMAC verification must happen on raw bytes before any parsing. Get this wrong and you've got an unauthenticated endpoint that runs arbitrary agent logic.
- **Concurrent event serialization** — Two events for the same PR arriving simultaneously need to be serialized. Two events for different PRs should run in parallel.
- **Keep-alive heartbeats** — The user triggered something and sees nothing. Heartbeats prove the agent hasn't crashed.

This demo teaches all four challenges through a CI/CD pipeline assistant triggered by GitHub-like webhook events.

## The Architecture

```
┌─────────────┐     POST /webhook      ┌──────────────────────────────────┐
│   GitHub /   │ ──────────────────────→│  1. Parse raw body (Buffer)      │
│   Simulate   │                        │  2. Verify HMAC signature        │
└─────────────┘                        │  3. Check replay window (5 min)  │
                                       │  4. Check idempotency (Set)      │
       ┌───────────────────────────────│  5. ACK immediately (202)        │
       │ 202 Accepted                  └──────────┬───────────────────────┘
       │ (< 10ms)                                 │
       ▼                                          ▼ async
┌─────────────┐                        ┌──────────────────────────────────┐
│  Platform    │                        │  Per-Session Queue               │
│  moves on   │                        │  ┌────────────────────────────┐  │
└─────────────┘                        │  │ pr-42: event1 → event2     │  │
                                       │  │ pr-43: event1              │  │
       ┌───────────────────────────────│  └────────────────────────────┘  │
       │ SSE broadcast                 └──────────┬───────────────────────┘
       ▼                                          │
┌─────────────┐                                   ▼
│  Browser UI  │                        ┌──────────────────────────────────┐
│  (EventSource)│←─────────────────────│  Agent Loop                      │
└─────────────┘    heartbeat, tools,   │  ┌ LLM → tools → LLM → ...  ┐  │
                   platform_post       │  │ post_comment → API call    │  │
                                       │  └────────────────────────────┘  │
                                       └──────────────────────────────────┘
```

The critical insight: the webhook handler ACKs **before** any agent processing starts. The actual work happens asynchronously, with results posted back to the platform via API calls (the `post_comment` tool), not via the HTTP response.

## Pattern 1: HMAC Signature Verification

Every webhook platform signs payloads so you can verify they're authentic. GitHub uses HMAC-SHA256, sending the signature in the `X-Hub-Signature-256` header as `sha256=<hex>`.

The #1 mistake is verifying the signature on a parsed-then-re-serialized body:

```typescript
// WRONG — parsing changes whitespace, key order, and encoding
const body = JSON.parse(rawString);
const reSerialzied = JSON.stringify(body);
const hash = hmac(reSerialzied); // Different from what GitHub signed!
```

The correct approach verifies on the raw bytes:

```typescript
// src/external-event-triggered/webhook.ts

export function verifySignature(
  rawBody: Buffer, // ← Buffer, not string
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;

  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody) // ← HMAC on raw bytes
    .digest("hex");

  const expectedBuffer = Buffer.from(`sha256=${expected}`, "utf-8");
  const receivedBuffer = Buffer.from(signatureHeader, "utf-8");

  // Constant-time comparison prevents timing attacks
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}
```

`crypto.timingSafeEqual` prevents timing attacks where an attacker measures response times to determine how many bytes of the expected signature match. A naive `===` comparison short-circuits on the first differing byte, leaking information.

## Pattern 2: Replay Protection and Idempotency

HMAC verification proves the payload is authentic, but a captured valid payload can be replayed indefinitely. Two defenses:

**Replay window** — reject events with timestamps older than 5 minutes:

```typescript
export function isReplayAttack(timestamp: number): boolean {
  const age = Date.now() - timestamp;
  return age > 5 * 60 * 1000;
}
```

**Idempotency** — GitHub retries failed deliveries and includes a unique `delivery_id`. Track seen IDs to prevent reprocessing:

```typescript
const seenDeliveries = new Set<string>();

export function isDuplicate(deliveryId: string): boolean {
  if (seenDeliveries.has(deliveryId)) return true;

  seenDeliveries.add(deliveryId);
  setTimeout(() => seenDeliveries.delete(deliveryId), 10 * 60 * 1000);
  return false;
}
```

The `setTimeout` cleanup prevents unbounded memory growth. In production, you'd use Redis with TTL keys instead of an in-memory Set.

## Pattern 3: Immediate ACK, Async Processing

Platform timeout requirements:

| Platform | Timeout | What happens on timeout                     |
| -------- | ------- | ------------------------------------------- |
| Slack    | 3s      | Retries 3x, then marks webhook as failing   |
| GitHub   | 10s     | Retries with increasing delay, up to 3 days |
| Linear   | 10s     | Retries 5x, then disables webhook           |
| Stripe   | 20s     | Retries with exponential backoff            |

Agent processing typically takes 10-60 seconds — well beyond any timeout. The solution is to ACK immediately and process asynchronously:

```typescript
// src/external-event-triggered/index.ts

async function handleWebhook(req, res) {
  const rawBody = await parseRawBody(req);

  // 1. Verify → 2. Parse → 3. Replay check → 4. Dedup check
  // ... (all fast, < 10ms total)

  // 5. ACK immediately — this is what meets the timeout contract
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "accepted", session_id: sessionId }));

  // Everything below runs AFTER the HTTP response is sent
  queue.enqueue(sessionId, async () => {
    await runWebhookAgent(event, sessionId, broadcast);
  });
}
```

The 202 Accepted status code specifically means "request accepted for processing, but processing has not been completed." This is semantically correct — unlike 200 OK, it signals that work is pending.

## Pattern 4: Per-Session Queue Serialization

Two events for PR #42 arriving at the same time must not run concurrently — the agent would get confused by interleaved tool calls and responses. But events for different PRs should run in parallel.

The `PerSessionQueue` achieves this with promise chaining:

```typescript
// src/external-event-triggered/queue.ts

export class PerSessionQueue {
  private chains = new Map<string, Promise<void>>();

  enqueue(sessionId: string, handler: () => Promise<void>): void {
    const existing = this.chains.get(sessionId) ?? Promise.resolve();

    const next = existing
      .catch(() => {}) // Swallow errors — don't break the chain
      .then(() => handler()) // Run after previous completes
      .finally(() => {
        // Auto-cleanup when chain is empty
        if (this.chains.get(sessionId) === next) {
          this.chains.delete(sessionId);
        }
      });

    this.chains.set(sessionId, next);
  }
}
```

Each `enqueue()` chains onto the previous promise. The `.catch(() => {})` before `.then()` ensures that if one event's processing fails, the next event still runs. The `.finally()` cleanup prevents the Map from growing unboundedly.

Session IDs are derived from the event payload — all events about PR #42 map to `pr-42`, all events about issue #7 map to `issue-7`:

```typescript
export function deriveSessionId(event: WebhookEvent): string {
  switch (event.type) {
    case "pull_request.opened":
      return `pr-${event.payload.number}`;
    case "check_run.completed":
      return `pr-${event.payload.pr_number}`;
    case "issue_comment.created":
      return `issue-${event.payload.issue_number}`;
  }
}
```

## Pattern 5: Activity Heartbeats

Once you ACK and start async processing, the developer who triggered the event sees nothing. Did the bot crash? Is it working? The `ActivityPoster` emits heartbeats during long processing:

```typescript
// src/external-event-triggered/activity-poster.ts

export class ActivityPoster {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastActivityTime = 0;

  start(): void {
    this.lastActivityTime = Date.now();
    this.heartbeatInterval = setInterval(() => {
      if (Date.now() - this.lastActivityTime >= 10_000) {
        this.emitFn("Still processing...");
        this.lastActivityTime = Date.now();
      }
    }, 10_000);
  }

  recordActivity(): void {
    this.lastActivityTime = Date.now();
  }
}
```

In the agent loop, every tool call and LLM response calls `recordActivity()`, resetting the heartbeat timer. If no real progress happens for 10 seconds, the heartbeat fires. In production, this would update a Slack message or post a GitHub check status.

## Pattern 6: Platform Response via API

The final pattern inverts the typical request-response model. In a chat UI, the agent responds through the HTTP response. In a webhook-triggered agent, the response goes back to the platform via its API:

```typescript
// Agent calls post_comment tool → result goes to GitHub, not to the webhook response
if (name === "post_comment") {
  emit({
    type: "platform_post",
    sessionId,
    target: args.target,
    body: args.body,
  });
}
```

The `post_comment` tool is the agent's way of "responding." In production, this would call `octokit.issues.createComment()` or the Slack `chat.postMessage` API. The webhook response (the 202 ACK) was sent minutes ago.

## Event-to-Prompt Conversion

Typed webhook events need to become natural language prompts the model can reason about. The `eventToPrompt` function bridges structured platform events and the freeform agent loop:

```typescript
function eventToPrompt(event: WebhookEvent): string {
  switch (event.type) {
    case "pull_request.opened":
      return [
        `A new pull request was opened:`,
        `- PR #${event.payload.number}: "${event.payload.title}"`,
        `- Author: ${event.payload.author}`,
        `- Branch: ${event.payload.head_branch} → ${event.payload.base_branch}`,
        ``,
        `Please analyze this PR: review the diff, suggest reviewers, and post a welcome comment.`,
      ].join("\n");
    // ...
  }
}
```

Each event type gets specific instructions in the prompt — "analyze diff and suggest reviewers" for PRs, "fetch logs and diagnose failure" for build failures.

## Running the Demo

```bash
pnpm dev:external-event-triggered
# Opens on http://localhost:3008
```

The browser UI has three simulator buttons:

1. **PR Opened** — watch the agent: fetch diff → list reviewers → analyze changes → post welcome comment
2. **Build Failed** — watch the agent: fetch CI logs → identify test failure root cause → post fix suggestion
3. **@bot Mention** — watch the agent: read question → gather context → post answer

Try clicking "PR Opened" twice rapidly — the second event queues behind the first. Try clicking it three times with the same delivery_id — the third shows a "DUPLICATE" badge.

## In the Wild: Coding Agent Harnesses

Webhook-triggered agents are how coding agent harnesses move beyond chat into automated CI/CD workflows.

**Claude Code Action** (GitHub Actions) is the most direct example. When configured in a repository's GitHub Actions workflow, it responds to `issues.opened`, `issue_comment.created`, and `pull_request.opened` events. The GitHub Action handler receives the webhook, authenticates via GitHub App credentials, and spawns Claude Code with the event context as input. Results are posted back via the GitHub API — exactly the ACK-then-process-then-post-back pattern. The Action has specific timeout handling for GitHub's 6-hour workflow limit.

**GitHub Copilot** handles issue assignment events. When a developer assigns Copilot to an issue, GitHub delivers a webhook that triggers Copilot's planning and implementation pipeline. It creates a branch, makes changes, and opens a PR — all triggered by the assignment event, not a chat message.

**Amazon Q Developer** uses label-based triggers. Adding a specific label to an issue triggers Q to analyze the issue, plan changes, and create a PR. This is a webhook-driven flow where the "prompt" is the issue body plus label, and the "response" is a PR with code changes.

**Devin** (Cognition) supports Slack triggers where mentioning @devin in a Slack channel sends a webhook that initiates an autonomous coding session. Devin's architecture handles the 3-second Slack timeout by immediately ACKing and posting progress updates as Slack message edits — a production implementation of the heartbeat pattern.

The common architecture across all these harnesses: immediate ACK to the platform, async processing in a sandbox, and results posted back via platform APIs.

## Key Takeaways

1. **Raw bytes for HMAC** — always verify signatures on the raw `Buffer`, never on parsed-then-re-serialized JSON. This is the #1 webhook security bug.

2. **ACK first, process later** — the HTTP response is just a receipt. Actual processing happens asynchronously, and results go back via platform APIs.

3. **Serialize per-session, parallelize across sessions** — promise chaining gives you both correctness (no interleaved PR processing) and throughput (independent PRs run concurrently).

4. **Three layers of protection** — HMAC verification (authenticity), replay window (freshness), and idempotency checks (exactly-once processing).

5. **Heartbeats build trust** — when processing takes 30+ seconds, periodic "still working..." updates prevent users from assuming the bot is broken.

6. **Events become prompts** — the bridge between typed webhook payloads and freeform agent reasoning is a `eventToPrompt` function that provides structured context and specific instructions.

## Sources & Further Reading

- [GitHub Webhooks — Securing your webhooks](https://docs.github.com/en/webhooks/using-webhooks/securing-your-webhooks) — official HMAC verification guide
- [GitHub Webhooks — Best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) — timeout handling, retry behavior, idempotency
- [Slack Events API](https://api.slack.com/apis/events-api) — 3-second timeout requirement, URL verification
- [Stripe Webhook Best Practices](https://docs.stripe.com/webhooks#best-practices) — signature verification, idempotency, ordering
- [AWS Prescriptive Guidance — Webhook ingestion](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-integrating-microservices/pub-sub.html) — queue-based async processing patterns
- [Claude Code GitHub Action](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/github-actions) — webhook-triggered coding agent in production
