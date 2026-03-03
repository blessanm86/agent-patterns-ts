// ─── Per-Session Promise Queue ───────────────────────────────────────────────
//
// Serializes event processing within a session while allowing parallelism
// across sessions. Events for PR #42 run one-at-a-time, but PR #42 and
// PR #43 events run concurrently.
//
// The trick: each enqueue() chains onto the previous promise for that
// session using .then(). If the previous handler rejects, the chain
// continues via .catch() — one failed event doesn't break the queue.

export class PerSessionQueue {
  private chains = new Map<string, Promise<void>>();

  enqueue(sessionId: string, handler: () => Promise<void>): void {
    const existing = this.chains.get(sessionId) ?? Promise.resolve();

    const next = existing
      // Swallow errors from the previous handler so the chain continues
      .catch(() => {})
      .then(() => handler())
      // Auto-cleanup: if this is still the tail of the chain, remove it
      .finally(() => {
        if (this.chains.get(sessionId) === next) {
          this.chains.delete(sessionId);
        }
      });

    this.chains.set(sessionId, next);
  }

  get activeSessions(): string[] {
    return [...this.chains.keys()];
  }
}
