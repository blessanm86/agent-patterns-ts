// ─── A2A Protocol Demo ────────────────────────────────────────────────────────
//
// Demonstrates the Agent2Agent (A2A) protocol end-to-end:
//
//   Step 1  Discovery    — fetch Agent Card from /.well-known/agent-card.json
//   Step 2  Streaming    — send a task via message/stream, watch SSE events arrive
//   Step 3  Polling      — verify final state via tasks/get
//
// Run modes:
//   pnpm dev:a2a-protocol        — streaming mode (message/stream over SSE)
//   pnpm dev:a2a-protocol:sync   — synchronous mode (message/send, blocks until done)

import "dotenv/config";

import { startA2AServer, A2A_PORT } from "./server.js";
import { fetchAgentCard, sendMessage, streamMessage, getTask } from "./client.js";
const BASE_URL = `http://localhost:${A2A_PORT}`;
const SYNC_MODE = process.argv.includes("--sync");

// ─── Display Helpers ──────────────────────────────────────────────────────────

function hr(label = ""): void {
  const line = "─".repeat(62);
  if (label) {
    console.log(`\n${line}\n  ${label}\n${line}`);
  } else {
    console.log(`\n${line}`);
  }
}

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

function stateIcon(state: string): string {
  switch (state) {
    case "submitted":
      return "○";
    case "working":
      return "◑";
    case "completed":
      return C.green("●");
    case "failed":
      return C.red("✗");
    case "canceled":
      return C.dim("⊘");
    default:
      return "?";
  }
}

function stateColor(state: string, s: string): string {
  switch (state) {
    case "completed":
      return C.green(s);
    case "working":
      return C.yellow(s);
    case "failed":
      return C.red(s);
    default:
      return C.dim(s);
  }
}

function shortId(id: string): string {
  return C.dim(id.slice(0, 8) + "…");
}

// ─── Main Demo ────────────────────────────────────────────────────────────────

async function runDemo(): Promise<void> {
  console.log(C.bold("\n  A2A Protocol — Ristorante Finder Demo"));
  console.log(
    C.dim(
      `  Mode: ${SYNC_MODE ? "synchronous  (message/send)" : "streaming  (message/stream → SSE)"}\n`,
    ),
  );

  // ── Spin up the A2A server ─────────────────────────────────────────────────
  process.stdout.write(C.dim("  Starting A2A server… "));
  const server = await startA2AServer();
  console.log(C.green(`done  (${BASE_URL})\n`));

  try {
    // ── Step 1: Agent Card Discovery ────────────────────────────────────────
    hr("Step 1 — Agent Card Discovery");

    console.log(C.dim(`\n  GET ${BASE_URL}/.well-known/agent-card.json\n`));

    const card = await fetchAgentCard(BASE_URL);

    console.log(`  ${C.bold("Agent")}        ${card.name}  ${C.dim(`v${card.version}`)}`);
    console.log(`  ${"Protocol".padEnd(12)}A2A ${card.protocolVersion}`);
    console.log(`  ${"Endpoint".padEnd(12)}${card.url}`);
    console.log(
      `  ${"Streaming".padEnd(12)}${card.capabilities.streaming ? C.green("yes") : C.dim("no")}`,
    );
    console.log(`  ${"Skills".padEnd(12)}`);
    for (const skill of card.skills) {
      console.log(`    ${C.cyan("•")} ${C.bold(skill.name)}: ${skill.description}`);
      if (skill.examples && skill.examples.length > 0) {
        console.log(`      ${C.dim(`e.g. "${skill.examples[0]}"`)}`);
      }
    }

    // ── Step 2: Send a Task ─────────────────────────────────────────────────
    const query =
      "Find me the best Italian restaurants in Rome. I want authentic local spots, not tourist traps.";

    hr("Step 2 — Send Task");
    console.log(`\n  Query: ${C.bold(`"${query}"`)}\n`);

    if (SYNC_MODE) {
      // ── Synchronous: message/send ──────────────────────────────────────
      console.log(C.dim(`  POST ${BASE_URL}/  (method: message/send)\n`));
      console.log(C.dim("  Waiting for agent to complete…\n"));

      const task = await sendMessage(BASE_URL, query);

      console.log(`  Task ID  ${shortId(task.id)}`);
      console.log(`  Status   ${stateColor(task.status.state, task.status.state)}`);

      if (task.artifacts && task.artifacts.length > 0) {
        hr("Result");
        for (const artifact of task.artifacts) {
          for (const part of artifact.parts) {
            if (part.kind === "text") {
              console.log("\n" + part.text);
            }
          }
        }
      }
    } else {
      // ── Streaming: message/stream (SSE) ────────────────────────────────
      console.log(C.dim(`  POST ${BASE_URL}/  (method: message/stream)\n`));

      let taskId = "";
      let artifactText = "";

      for await (const event of streamMessage(BASE_URL, query)) {
        if (event.kind === "status-update") {
          taskId = event.taskId;
          const { state, message } = event.status;
          const icon = stateIcon(state);
          const label = stateColor(state, state.padEnd(14));
          const finalTag = event.final ? C.dim("  [final]") : "";

          if (message) {
            // Tool-call progress message embedded in status update
            const toolText = message.parts.find((p) => p.kind === "text")?.text ?? "";
            console.log(`  ${icon}  ${shortId(event.taskId)}  ${label}  ${C.cyan(toolText)}`);
          } else {
            console.log(`  ${icon}  ${shortId(event.taskId)}  ${label}${finalTag}`);
          }
        }

        if (event.kind === "artifact-update") {
          for (const part of event.artifact.parts) {
            if (part.kind === "text") {
              artifactText = part.text;
            }
          }
        }
      }

      // Print the artifact after all events have arrived
      if (artifactText) {
        hr("Artifact — Restaurant Recommendations");
        console.log("\n" + artifactText);
      }

      // ── Step 3: Verify via tasks/get (polling fallback) ────────────────
      if (taskId) {
        hr("Step 3 — Verify via tasks/get  (polling fallback)");
        console.log(C.dim(`\n  POST ${BASE_URL}/  (method: tasks/get)\n`));

        const retrieved = await getTask(BASE_URL, taskId);

        console.log(`  Task ID    ${shortId(retrieved.id)}`);
        console.log(`  Status     ${stateColor(retrieved.status.state, retrieved.status.state)}`);
        console.log(`  Artifacts  ${retrieved.artifacts?.length ?? 0}`);
        console.log(`  Timestamp  ${C.dim(retrieved.status.timestamp)}`);
      }
    }

    hr();
    console.log(C.green("  ✓ Demo complete") + "\n");
  } finally {
    server.close();
  }
}

runDemo().catch((err) => {
  console.error(err);
  process.exit(1);
});
