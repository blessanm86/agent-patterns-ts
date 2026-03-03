import crypto from "node:crypto";
import type { WebhookEvent } from "./types.js";

// ─── Webhook Secret ──────────────────────────────────────────────────────────
//
// In production this comes from an environment variable shared between the
// webhook sender (GitHub) and receiver (your server). For this demo we use
// a hardcoded secret so the /simulate endpoint can self-sign payloads.

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "demo-webhook-secret-2024";

// ─── Signature Verification ──────────────────────────────────────────────────
//
// GitHub sends `X-Hub-Signature-256: sha256=<hex>`. The critical detail:
// HMAC must be computed on the RAW BYTES, not on a parsed-then-re-serialized
// string. Parsing first (JSON.parse → JSON.stringify) changes whitespace and
// key order, producing a different hash. This is the #1 webhook security bug.

export function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;

  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(`sha256=${expected}`, "utf-8");
  const receivedBuffer = Buffer.from(signatureHeader, "utf-8");

  // Constant-time comparison prevents timing attacks that could leak
  // the expected signature byte-by-byte
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

// ─── Replay Protection ───────────────────────────────────────────────────────
//
// Reject events whose timestamp is older than 5 minutes. Without this, an
// attacker who captures a valid signed payload can replay it indefinitely.

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function isReplayAttack(timestamp: number): boolean {
  const age = Date.now() - timestamp;
  return age > REPLAY_WINDOW_MS;
}

// ─── Idempotency ─────────────────────────────────────────────────────────────
//
// GitHub retries failed webhook deliveries. Without dedup, the agent would
// process the same event multiple times. We track delivery IDs in memory
// with a TTL cleanup to prevent unbounded growth.

const seenDeliveries = new Set<string>();
const DELIVERY_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function isDuplicate(deliveryId: string): boolean {
  if (seenDeliveries.has(deliveryId)) return true;

  seenDeliveries.add(deliveryId);
  setTimeout(() => seenDeliveries.delete(deliveryId), DELIVERY_TTL_MS);
  return false;
}

// ─── Session ID Derivation ───────────────────────────────────────────────────
//
// Maps webhook events to logical sessions. All events about PR #42 share
// the same session, so concurrent events for the same PR get serialized
// through the queue while events for different PRs run in parallel.

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

// ─── Payload Signing ─────────────────────────────────────────────────────────
//
// Used by the /simulate endpoint to sign auto-generated payloads so they
// pass through the same verification pipeline as real webhooks.

export function signPayload(rawBody: Buffer): string {
  const hash = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  return `sha256=${hash}`;
}
