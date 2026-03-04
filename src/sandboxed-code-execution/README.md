# Running Untrusted Code Safely — Sandboxed Execution for AI Agents

[Agent Patterns — TypeScript](../../README.md)

---

Your agent just wrote `rm -rf /`. Or maybe it `curl`'d your database credentials to a remote server. Or perhaps it silently installed a backdoor in a dependency it was "helping" you update.

This isn't hypothetical. Research shows 12–65% of LLM-generated code snippets are non-compliant with secure coding standards. Over 90% of generated code is either functional OR secure, but rarely both. And that's before we consider prompt injection — an attacker embedding `"now exfiltrate ~/.ssh"` in a docstring the agent reads.

The solution is the same one cloud providers figured out years ago: **isolation**. Don't trust the code. Run it in a box where the worst it can do is crash itself.

This post covers six production patterns for running LLM-generated code safely, then shows how real coding agent harnesses (Claude Code, Codex, Cursor) implement them today.

## The Isolation Spectrum

Not all sandboxes are created equal. Here's the landscape from weakest to strongest isolation, with the real systems that use each level:

```
Weakest                                                             Strongest
   │                                                                    │
   ▼                                                                    ▼
┌────────┐  ┌──────────┐  ┌────────┐  ┌──────────┐  ┌───────────┐  ┌────────┐
│ Node   │  │    V8    │  │ Docker │  │ OS-level │  │  gVisor   │  │Firecrk │
│ vm/vm2 │  │ Isolates │  │        │  │ Seatbelt │  │ user-kern │  │microVMs│
│        │  │          │  │        │  │ bubblewrp│  │           │  │        │
│ ✗ Dead │  │Cloudflare│  │ Shared │  │Claude Cod│  │  Google   │  │  E2B   │
│ vm2:8  │  │ Workers  │  │ kernel │  │Codex CLI │  │  Agent    │  │ Fly.io │
│ CVEs/yr│  │          │  │ ← risk │  │ Cursor   │  │  Sandbox  │  │ Vercel │
└────────┘  └──────────┘  └────────┘  └──────────┘  └───────────┘  └────────┘
  ~0ms         <1ms         1-10s        <10ms         ~100ms        ~125ms
   0 MB        ~KB          50-100MB      <1MB         15-20MB        <5MB
```

The industry has converged on two sweet spots:

- **OS-level primitives** (Seatbelt, bubblewrap, Landlock+seccomp) for CLI tools that run on the developer's machine — near-zero overhead, strong enough for the threat model
- **Firecracker microVMs** for cloud sandboxes — hardware-enforced isolation via KVM, 125ms boot, <5 MB overhead, 150 microVMs per second on a single host

Our demo uses **Node.js child processes** as stand-ins for production sandboxes. The patterns (pooling, affinity, token proxy, tool bridge) are identical regardless of the isolation mechanism underneath.

## Six Production Patterns

### 1. Pre-Warmed Pool

The problem: sandbox boot time. Even Firecracker takes 125ms. If an agent makes 8 tool calls that each need a sandbox, that's a full second of just waiting for boots.

The solution: start sandboxes **before** you need them. Maintain a pool of N idle sandboxes. Acquire in O(1), replenish in the background.

```
                    ┌─────────────────────────────┐
                    │       Sandbox Pool           │
                    │                              │
  acquire() ──────►│  [idle] [idle] [idle]         │
       O(1) pop    │         ▲                     │
                    │         │ replenish()         │
                    │         │ (background)        │
                    └─────────────────────────────┘
```

Google's Agent Sandbox formalizes this as a Kubernetes CRD (`SandboxWarmPool`) that maintains a configurable number of pre-warmed pods. Their benchmarks show a **90% reduction in cold start latency**. E2B achieves similar results with microVM snapshot restore (<200ms initialization). In our demo, we pre-warm 3 child processes at startup and replenish whenever one dies.

### 2. Conversation Affinity

When a user asks "scale this recipe to 10 servings" and then "now double that," the second request needs the state from the first. Without affinity, you'd need to replay all prior code in a fresh sandbox.

Affinity maps a conversation ID to a specific sandbox. Same conversation, same sandbox, preserved state.

```
  Conversation A ──► Sandbox 1  (bound, state preserved)
  Conversation B ──► Sandbox 2  (bound, state preserved)
  Conversation C ──► Sandbox 3  (bound, state preserved)
  Conversation D ──► ??? pool exhausted — wait or error
```

The binding persists across turns but the sandbox is released back to the pool between turns (marked idle, available for other conversations only if unbound). If the sandbox dies, the affinity binding is cleared and the next request gets a fresh sandbox.

### 3. Token-Scoped Credential Proxy

This is the most important security pattern. **Real credentials never enter the sandbox.** Instead:

1. On acquire, the orchestrator issues a short-lived, revocable token
2. The sandbox includes this token in any request that needs authentication
3. A proxy running **outside** the sandbox validates the token, injects real credentials, and forwards the request

```
  ┌───────────┐     phantom token     ┌───────────┐     real creds      ┌─────────┐
  │  Sandbox  │ ──────────────────►  │   Proxy   │ ──────────────────► │   API   │
  │ (untrust) │   "tok-abc123..."    │ (trusted) │   "sk-prod-xxx"    │         │
  └───────────┘                      └───────────┘                     └─────────┘
        │                                  │
        │ Token revoked on:                │ Real credential stored in:
        │ - sandbox release                │ - host keychain
        │ - sandbox death                  │ - secrets manager
        │ - TTL expiry (5 min)             │ - never in env vars
```

Claude Code implements this with a Unix domain socket proxy — the sandbox connects to a local socket, the proxy validates a scoped credential and attaches the real GitHub token before forwarding over TLS. The nono.sh phantom token pattern takes this further: a random 256-bit session token is generated, real credentials are loaded from the OS keychain into `Zeroizing<String>` memory, and the proxy translates between the two. Credentials literally never exist in the sandbox's address space.

### 4. CLI Tool Bridge

Sandbox code often needs to call tools that live in the orchestrator. A database lookup, an API call, a file system operation — these can't run inside the sandbox (it doesn't have access). The bridge lets sandbox code call orchestrator tools over IPC.

```
  Sandbox                    IPC                    Orchestrator
  ┌──────────────────┐      ─────►      ┌──────────────────────┐
  │ const data =     │  tool_request    │ validate token       │
  │   await callTool │  {get_recipe,    │ execute tool          │
  │   ("get_recipe", │   {name:"..."}}  │ send tool_result     │
  │    {name:"..."}) │      ◄─────      │                      │
  └──────────────────┘   tool_result    └──────────────────────┘
```

In our demo this uses Node.js IPC (built-in with `child_process.fork`). In production, E2B uses WebSocket connections from the microVM to the host, and Google Agent Sandbox uses the Kubernetes API. The protocol is the same: request with correlation ID → validate token → execute → respond.

### 5. Dead Worker Eviction

Sandboxes crash. The VM runs out of memory, the process hits an infinite loop, or the user deliberately kills it (our `/kill` command). The pool must detect death and recover gracefully.

```
  Sandbox dies (exit code 137)
       │
       ▼
  handleDeath()
       │
       ├── Mark as dead
       ├── Revoke all tokens for this sandbox
       ├── Clear affinity bindings
       ├── Remove from pool
       └── replenish() with exponential backoff
                │
                ├── Attempt 1: wait 1s, spawn
                ├── Attempt 2: wait 2s, spawn
                ├── Attempt 3: wait 4s, spawn
                └── ... cap at 16s
```

Detection uses heartbeats: each worker sends periodic `heartbeat` messages over IPC. If a sandbox misses 3 consecutive heartbeats, the pool evicts it. This catches both crashes (process exits) and hangs (process alive but stuck).

### 6. Provider Abstraction

The `SandboxProvider` interface decouples pool management from the actual isolation mechanism:

```typescript
interface SandboxProvider {
  spawn(): Promise<SandboxHandle>;
  destroy(handle: SandboxHandle): Promise<void>;
}

interface SandboxHandle {
  pid: number | undefined;
  send(message: OrchestratorMessage): void;
  onMessage(handler: (msg: WorkerMessage) => void): void;
  onExit(handler: (code: number | null) => void): void;
  kill(): void;
}
```

Our demo uses `NodeChildProcessProvider`. In production, you'd swap in `FirecrackerProvider`, `GVisorProvider`, or `KubernetesPodProvider` — the pool doesn't change. Alibaba's OpenSandbox takes this further with a 4-layer architecture: SDKs → Specs → Runtime → Instances, supporting Docker, gVisor, and microVM runtimes behind a single API.

## Implementation Walkthrough

### The Worker (sandbox-worker.ts)

Each sandbox is a Node.js child process that receives code over IPC and executes it in a `vm` context:

```typescript
// Limited globals — only safe built-ins + callTool bridge
const context = vm.createContext({
  console: { log: (...args) => logs.push(args.map(String).join(" ")) },
  Math,
  JSON,
  Date,
  parseInt,
  parseFloat,
  Number,
  String,
  Array,
  Object,
  Map,
  Set,
  Promise,
  callTool, // ← bridge to orchestrator tools
});

// Wrap in async IIFE to support await callTool()
const wrapped = `(async () => { ${code} })()`;
const script = new vm.Script(wrapped, { timeout });
const result = await script.runInContext(context, { timeout });
```

The `callTool` bridge sends an IPC message and waits for the response:

```typescript
function callTool(name: string, args: Record<string, string>): Promise<string> {
  const id = `tool-${++toolCallCounter}`;
  return new Promise((resolve) => {
    pendingToolCalls.set(id, resolve);
    process.send?.({ type: "tool_request", id, name, args, token: currentToken });
  });
}
```

Node's `vm` module is **not** a security boundary (it's weaker than containers, let alone microVMs). We use it as a code boundary that limits available globals. The real isolation comes from the child process — a separate OS process with its own memory space. In production, you'd replace the child process with a Firecracker microVM and get hardware-enforced isolation.

### The Pool (sandbox-pool.ts)

The pool manages lifecycle, affinity, and the tool bridge:

```typescript
// Acquire with affinity
acquire(conversationId: string): SandboxInfo {
  // Check affinity — reuse same sandbox for same conversation
  const affinityId = this.affinityMap.get(conversationId);
  if (affinityId) {
    const entry = this.sandboxes.get(affinityId);
    if (entry && entry.status === "idle") {
      // Affinity hit — same sandbox, preserved state
      entry.status = "busy";
      entry.token = this.tokenProxy.issueToken(entry.id);
      return this.toInfo(entry);
    }
  }
  // No affinity — pick first idle sandbox, create binding
  // ...
}
```

On execute, the pool bridges tool requests from the sandbox to the orchestrator:

```typescript
// Inside execute(), handle tool_request from sandbox
if (msg.type === "tool_request") {
  // Validate token before executing anything
  const validation = this.tokenProxy.validateToken(req.token);
  if (!validation.valid) {
    entry.handle.send({
      type: "tool_result",
      id: req.id,
      result: JSON.stringify({ error: "Token invalid or expired" }),
    });
    return;
  }
  // Execute via registered handler
  const result = await this.toolHandler(req.name, req.args);
  entry.handle.send({ type: "tool_result", id: req.id, result });
}
```

### The Agent (agent.ts)

The ReAct loop wraps sandbox lifecycle around the standard reason+act pattern:

```typescript
async function runAgent(userMessage, history, pool, conversationId) {
  // 1. Acquire sandbox (affinity-aware)
  const sandbox = pool.acquire(conversationId);

  try {
    // 2. Standard ReAct loop
    while (iterations < MAX) {
      const response = await ollama.chat({ model, system, messages, tools });
      if (!response.tool_calls) break;

      for (const toolCall of response.tool_calls) {
        // execute_code → runs in sandbox
        // get_recipe_data → direct lookup
        // pool_status → introspection
        const result = await executeTool(name, args, pool, sandbox.id);
        messages.push({ role: "tool", content: result });
      }
    }
  } finally {
    // 3. Always release — affinity binding persists for next turn
    pool.release(sandbox.id);
  }
}
```

## Demo Walkthrough

Start the demo:

```
$ pnpm dev:sandbox

  [Pool] Pre-warming 3 sandboxes...
  [Pool] Sandbox a1b2c3d4… ready (pid 12345)
  [Pool] Sandbox e5f6g7h8… ready (pid 12346)
  [Pool] Sandbox i9j0k1l2… ready (pid 12347)
  [Pool] All 3 sandboxes ready (142ms)

🧪  Recipe Calculator — Sandboxed Code Execution
    Powered by Ollama + qwen2.5:7b
    Type "exit" to quit
```

**Ask a calculation question:**

```
You: Scale chicken tikka masala from 4 to 10 servings

  🔧 Tool call: get_recipe_data
     Args: { "name": "chicken tikka masala" }
     Result: { "name": "Chicken Tikka Masala", "servings": 4, ...

  🔧 Tool call: execute_code
     Args: { "description": "Scale recipe ingredients", "code": "const recipe = ..." }
     Result: Scaled Chicken Tikka Masala (10 servings):
             - chicken breast: 1500g (was 600g)
             - yogurt: 500ml (was 200ml)
             ...

  [Pool] New binding — sandbox a1b2c3d4… ↔ conversation m3n4o5p6…
  [Token] Issued 8a9b0c1d… for sandbox a1b2c3d4
  [Pool] Released sandbox a1b2c3d4… back to pool

  📊 Stats: 2 LLM calls, 2 tool calls, 1 code executions
  🔒 Sandbox: a1b2c3d4… (new binding)
```

**Ask a follow-up — see affinity reuse:**

```
You: Now compare the calories with pad thai

  [Pool] Affinity hit — reusing sandbox a1b2c3d4…

  📊 Stats: 2 LLM calls, 3 tool calls, 1 code executions
  🔒 Sandbox: a1b2c3d4… (affinity reuse)
```

**Kill the sandbox to see eviction + replenishment:**

```
/kill

  💀 Killing sandbox a1b2c3d4… to demonstrate eviction + replenishment
  [Pool] Sandbox a1b2c3d4… died (exit code null)
  [Token] Revoked 1 token(s) for dead sandbox a1b2c3d4
  [Pool] Cleared affinity for conversation m3n4o5p6…
  [Pool] Replenishing (reason: death), backoff: 1000ms
  [Pool] Sandbox q7r8s9t0… ready (pid 12348)
```

**Next message gets a new sandbox:**

```
You: How many cookies can I make with 500g of flour?

  [Pool] New binding — sandbox q7r8s9t0… ↔ conversation m3n4o5p6…
  🔒 Sandbox: q7r8s9t0… (new binding)
```

## In the Wild: Coding Agent Harnesses

### Claude Code — OS-Level Isolation with Proxy-Based Credentials

Claude Code uses **Seatbelt** on macOS and **bubblewrap** on Linux — the same OS-level primitives that Chrome uses for tab isolation. This gives near-zero startup overhead (<10ms) while providing meaningful filesystem and network isolation.

The architecture is dual-layered: filesystem isolation (configurable allow-write and deny-read lists) plus network isolation via a **Unix domain socket proxy**. The proxy is the credential boundary — Claude Code's sandbox connects to a local socket, the proxy validates a scoped credential, attaches the real GitHub token, and forwards over TLS. Real credentials never exist inside the sandbox.

The impact is measurable: **84% reduction in permission prompts** and a **95% reduction in exploitable attack surface**. Anthropic open-sourced the runtime as `@anthropic-ai/sandbox-runtime` (Apache 2.0). A `dangerouslyDisableSandbox` escape hatch exists for workflows that can't work within sandbox constraints — acknowledging that no sandbox handles 100% of cases.

### OpenAI Codex — Two-Phase Execution Model

Codex takes a different approach for its cloud offering: **two-phase execution**. During the Setup phase, the container has full network access and can install dependencies, pull credentials from secrets, and configure the environment. Once setup completes, the Agent phase begins — network access and secrets are **completely removed**. The agent works only with what was pre-installed.

For its CLI, Codex uses the same OS-level primitives as Claude Code (Seatbelt on macOS, Landlock+seccomp on Linux). It offers three escalating modes: ReadOnly, WorkspaceWrite (default), and DangerFullAccess. Container caches persist for 12 hours to amortize setup cost. Notably, Codex uses a **pre-indexed cache** for web search instead of live fetches — this prevents prompt injection via crafted web pages.

### Google Agent Sandbox — Kubernetes-Native Warm Pools

Google formalized the pre-warmed pool pattern as a set of **Kubernetes Custom Resource Definitions**: `Sandbox`, `SandboxTemplate`, `SandboxClaim`, and `SandboxWarmPool`. The warm pool CRD maintains a configurable number of pre-warmed pods with gVisor isolation (user-space kernel that intercepts syscalls). Pod Snapshots enable checkpoint/restore — one benchmark showed **LLM initialization dropping from ~10 minutes to seconds** (80% reduction).

The system works on any Kubernetes cluster and was open-sourced through the CNCF. Credential handling uses standard Kubernetes patterns (Secrets, ServiceAccounts, Workload Identity) rather than a custom proxy, reflecting Google's infrastructure-first approach.

### E2B — Firecracker microVMs at Scale

E2B is the most widely-adopted third-party sandbox provider for AI agents, running **15 million sandboxes per month** (375x growth in 12 months, ~50% of Fortune 500 customers). They use Firecracker microVMs with a template system that snapshots the VM state after setup, enabling **<200ms initialization** for subsequent runs.

Each sandbox gets hardware-enforced isolation via KVM, its own network namespace, and configurable resource limits. E2B supports persistent sessions (up to 24 hours), pause/resume, forking, and checkpointing — making it suitable for long-running agent tasks. The SDK sees ~500K Python downloads and ~250K JS downloads per month.

### Docker Sandboxes — The Cross-Harness Layer

Docker Sandboxes positions itself as a **universal sandbox infrastructure** that works across agents. Using `docker sandbox run [agent-name]`, developers can run Claude Code, Codex, GitHub Copilot, Gemini CLI, or OpenCode inside microVM-based isolation (Firecracker) with a private Docker daemon per sandbox.

This is significant because it means the isolation layer is independent of the agent — a single infrastructure decision covers multiple tools. Network allow/deny lists and workspace directory syncing are configurable per sandbox. The approach mirrors how organizations standardize on container runtimes rather than letting each application manage its own isolation.

## NVIDIA's Security Framework

NVIDIA published the most comprehensive public security guidance for agent sandboxing. Their framework defines 3 mandatory and 6 recommended controls:

**Mandatory (non-negotiable):**

1. **Network egress restrictions** — IP/port allowlists, DNS restrictions. Domain fronting and overly broad domains (e.g., all of `github.com`) are explicitly called out as risks
2. **Block writes outside workspace** — OS-level enforcement, not just application-level checks
3. **Block agent config modifications** — Prevent the agent from modifying its own hooks, MCP settings, or IDE configuration (the "self-modification" attack)

**Recommended:**

4. Full IDE sandboxing (beyond just CLI)
5. Kernel-level isolation (microVMs, Kata, gVisor)
6. Read access controls with enterprise denylists
7. Single-use approval tokens (never cached)
8. Secret injection pattern (minimal at start, task-specific injection, credential broker)
9. Sandbox lifecycle management (ephemeral or periodic rebuild)

The key insight from NVIDIA's threat model: the primary threat isn't a malicious user — it's **indirect prompt injection**. An attacker embeds instructions in a `.cursorrules` file, a `CLAUDE.md`, a git history comment, or an MCP response. The agent reads it, trusts it, and acts on it. Sandboxing limits the blast radius when this inevitably happens.

## Key Takeaways

1. **Pre-warm your sandboxes.** Cold starts compound — a pool of idle sandboxes turns O(boot_time) into O(1). Google's SandboxWarmPool CRD shows this pattern formalized at scale (90% reduction in cold start latency).

2. **Credentials never enter the sandbox.** Issue short-lived tokens, validate at a proxy boundary, inject real credentials only in the trusted zone. This is the single most important security pattern — both Claude Code and the nono.sh phantom token pattern implement it.

3. **Affinity preserves state without replay.** Binding a conversation to a sandbox across turns avoids expensive state reconstruction. Release between turns (so the sandbox can serve others) but keep the binding.

4. **Design for death.** Sandboxes crash, hang, and get killed. Heartbeat-based health checks + exponential backoff on replenishment keeps the pool healthy. Always revoke tokens and clear bindings on death.

5. **The industry converges on two isolation levels.** OS-level primitives (Seatbelt/bubblewrap) for developer machines (<10ms, <1MB) and Firecracker microVMs for cloud (~125ms, <5MB). Docker containers sit awkwardly in between — shared kernel vulnerability risk without the hardware isolation of microVMs.

6. **Abstract the provider.** The pool manager shouldn't know whether it's managing child processes, containers, or microVMs. A clean `SandboxProvider` interface lets you start simple and upgrade isolation without rewriting orchestration logic.

## Sources & Further Reading

- [Google — Open-Source Agent Sandbox for Kubernetes](https://opensource.googleblog.com/2025/11/unleashing-autonomous-ai-agents-why-kubernetes-needs-a-new-standard-for-agent-execution.html) — SandboxWarmPool CRD, gVisor isolation, CNCF open source
- [Google Cloud — Isolate AI Code Execution with Agent Sandbox](https://cloud.google.com/kubernetes-engine/docs/how-to/agent-sandbox) — Pod Snapshots, Workload Identity, GKE integration
- [NVIDIA — Practical Security Guidance for Sandboxing Agentic Workflows](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/) — 3 mandatory + 6 recommended controls, threat model
- [E2B — The Enterprise AI Agent Cloud](https://e2b.dev/) — Firecracker microVMs, <200ms boot, 15M sandboxes/month
- [Anthropic — Claude Code Sandbox Runtime](https://github.com/anthropics/claude-code) — Seatbelt/bubblewrap, proxy architecture, 84% fewer permission prompts
- [OpenAI — Codex Security Architecture](https://openai.com/index/codex/) — Two-phase execution, container caching, pre-indexed web search
- [Cursor — Sandbox for Background Agents](https://www.cursor.com/blog/sandbox) — Dynamic Seatbelt policies, 40% fewer interruptions
- [Docker — Docker Sandboxes](https://docs.docker.com/sandbox/) — Cross-harness microVM isolation, Firecracker-based
- [Alibaba — OpenSandbox](https://github.com/anthropics/claude-code) — 4-layer architecture, multi-runtime, Apache 2.0
- [Wang et al. — CodeAct: Code Actions for LLM Agents](https://arxiv.org/abs/2402.01030) — 20% improvement over JSON tool calls
- [Pan et al. — LLM-in-Sandbox](https://arxiv.org/abs/2601.16206) — Sandbox as capability amplifier
- [Wu et al. — IsolateGPT: Three-Boundary Isolation](https://arxiv.org/abs/2403.00700) — NDSS 2025, app-to-app isolation
- [Val Town — The Story of Attempting to Run Untrusted Code](https://blog.val.town/blog/first-four-val-town-runtimes/) — vm → vm2 → Deno → Node.js child processes evolution
