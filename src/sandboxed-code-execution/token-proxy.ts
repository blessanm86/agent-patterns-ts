// ─── Token-Scoped Credential Proxy ────────────────────────────────────────────
//
// Instead of injecting real API keys into sandboxes, we issue short-lived,
// revocable tokens. The proxy validates tokens and injects real credentials
// only at the orchestrator boundary — credentials never enter the sandbox.
//
// This mirrors production patterns like E2B's credential proxy and
// Google Agent Sandbox's Workload Identity.

import { randomUUID } from "node:crypto";

// ─── The Real Credentials (never enter the sandbox) ──────────────────────────

export const RECIPE_API_KEY = "sk-recipe-prod-xxxxx";

// ─── Token Record ─────────────────────────────────────────────────────────────

interface TokenRecord {
  token: string;
  sandboxId: string;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
}

// ─── Token Proxy ──────────────────────────────────────────────────────────────

export class TokenProxy {
  private tokens = new Map<string, TokenRecord>();
  private ttlMs: number;

  constructor(ttlMs: number = 5 * 60 * 1_000) {
    this.ttlMs = ttlMs;
  }

  /** Issue a new token scoped to a sandbox. */
  issueToken(sandboxId: string): string {
    const token = randomUUID();
    const now = Date.now();
    this.tokens.set(token, {
      token,
      sandboxId,
      issuedAt: now,
      expiresAt: now + this.ttlMs,
      revoked: false,
    });
    console.log(`  [Token] Issued ${token.slice(0, 8)}… for sandbox ${sandboxId}`);
    return token;
  }

  /** Validate a token — checks expiry and revocation. */
  validateToken(token: string): { valid: boolean; sandboxId?: string } {
    const record = this.tokens.get(token);
    if (!record) return { valid: false };
    if (record.revoked) return { valid: false };
    if (Date.now() > record.expiresAt) return { valid: false };
    return { valid: true, sandboxId: record.sandboxId };
  }

  /** Revoke a specific token. */
  revokeToken(token: string): void {
    const record = this.tokens.get(token);
    if (record) {
      record.revoked = true;
      console.log(`  [Token] Revoked ${token.slice(0, 8)}… (sandbox ${record.sandboxId})`);
    }
  }

  /** Revoke all tokens for a sandbox — cleanup on death. */
  revokeAllForSandbox(sandboxId: string): void {
    let count = 0;
    for (const record of this.tokens.values()) {
      if (record.sandboxId === sandboxId && !record.revoked) {
        record.revoked = true;
        count++;
      }
    }
    if (count > 0) {
      console.log(`  [Token] Revoked ${count} token(s) for dead sandbox ${sandboxId}`);
    }
  }

  /** Count of non-revoked, non-expired tokens. */
  getActiveCount(): number {
    const now = Date.now();
    let count = 0;
    for (const record of this.tokens.values()) {
      if (!record.revoked && now < record.expiresAt) count++;
    }
    return count;
  }
}
