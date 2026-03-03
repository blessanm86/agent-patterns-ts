// ─── Activity Poster ─────────────────────────────────────────────────────────
//
// Platforms like Slack require a response within 3 seconds. Even GitHub's
// more generous 10s timeout expects a quick ACK. Once you've ACKed and
// started async processing, the user sees nothing — did the bot crash?
//
// The ActivityPoster solves this with two mechanisms:
//   1. Heartbeat — every 10s, emit "Still processing..." if no real progress
//   2. Throttle — real updates are rate-limited to 1/second to avoid spam
//
// Usage in agent.ts: wrap the agent loop with start()/stop() in try/finally.

export class ActivityPoster {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastActivityTime = 0;
  private emitFn: (message: string) => void;

  private readonly HEARTBEAT_INTERVAL_MS = 10_000; // 10 seconds
  private readonly THROTTLE_MS = 1_000; // 1 second

  constructor(emit: (message: string) => void) {
    this.emitFn = emit;
  }

  start(): void {
    this.lastActivityTime = Date.now();
    this.heartbeatInterval = setInterval(() => {
      const elapsed = Date.now() - this.lastActivityTime;
      if (elapsed >= this.HEARTBEAT_INTERVAL_MS) {
        this.emitFn("Still processing...");
        this.lastActivityTime = Date.now();
      }
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** Record that real progress happened. Resets the heartbeat timer. */
  recordActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /** Returns true if enough time has passed since the last emitted update. */
  shouldEmit(): boolean {
    const now = Date.now();
    if (now - this.lastActivityTime >= this.THROTTLE_MS) {
      this.lastActivityTime = now;
      return true;
    }
    return false;
  }
}
