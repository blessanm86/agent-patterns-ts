import { runTopology } from "./agent.js";
import type { TopologyName, TopologyResult } from "./agent.js";

// ─── Task ─────────────────────────────────────────────────────────────────────

const DEMO_TASK =
  'Create a product launch plan for the "Nomad Track Wallet" — a minimalist wallet with built-in GPS tracking, RFID-blocking technology, and 2-year battery life. Connects to iOS/Android app for real-time location. Target retail price: $79.';

// ─── Topology error propagation characteristics (for display) ─────────────────

const TOPOLOGY_NOTES: Record<TopologyName, string> = {
  chain:
    "Linear — errors at step N taint all N+1..end. Context grows with each step (full history). 0.95^4 = 81% end-to-end reliability.",
  star: "Contained — one failing specialist doesn't affect others. Synthesizer acts as circuit breaker. Google DeepMind: 4.4x vs 17.2x for bag-of-agents.",
  tree: "Bidirectional — bad decomposition cascades down; leaf failures block upward synthesis. Highest token cost. Best for genuinely hierarchical domains.",
  graph:
    "Surgical — errors propagate only along explicit dependency edges. Independent branches are unaffected. Targeted context passing prevents prompt bloat.",
};

const TOPOLOGY_STRUCTURE: Record<TopologyName, string> = {
  chain: "requirements → pricing → marketing → technical  (sequential)",
  star: "[requirements, pricing, marketing, technical] → synthesizer  (parallel fan-out)",
  tree: "director → [strategy-lead(req+pricing), execution-lead(mkt+tech)]  (2-level hierarchy)",
  graph:
    "wave1:[requirements,audience] → wave2:[pricing,technical] → wave3:[copy] → wave4:[brief]  (DAG)",
};

// ─── Display helpers ──────────────────────────────────────────────────────────

function printDivider(char = "─", width = 64): void {
  console.log(char.repeat(width));
}

function printTopologyHeader(topology: TopologyName): void {
  printDivider("═");
  console.log(`  Topology: ${topology.toUpperCase()}`);
  console.log(`  Structure: ${TOPOLOGY_STRUCTURE[topology]}`);
  printDivider("═");
}

function printResult(result: TopologyResult): void {
  printDivider();
  console.log("  OUTPUT");
  printDivider();
  console.log(result.output);

  printDivider();
  console.log("  METRICS");
  printDivider();
  console.log(`  Duration:      ${(result.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  LLM calls:     ${result.llmCallCount}`);
  console.log(`  Agent outputs: ${result.specialists.length}`);
  console.log(`  Error model:   ${TOPOLOGY_NOTES[result.topology]}`);
}

function printComparisonTable(results: TopologyResult[]): void {
  console.log("\n");
  printDivider("═");
  console.log("  TOPOLOGY COMPARISON");
  printDivider("═");

  const header = `  ${"Topology".padEnd(8)} ${"Duration".padEnd(10)} ${"LLM Calls".padEnd(11)} ${"Agents".padEnd(8)} Context flow`;
  console.log(header);
  printDivider();

  const contextFlow: Record<TopologyName, string> = {
    chain: "Accumulated (each agent sees all prior outputs)",
    star: "Isolated (specialists see only original task)",
    tree: "Domain-scoped (leaves see only domain task)",
    graph: "Targeted (each node sees only its dependencies)",
  };

  for (const r of results) {
    const dur = `${(r.totalDurationMs / 1000).toFixed(1)}s`.padEnd(10);
    const calls = String(r.llmCallCount).padEnd(11);
    const agents = String(r.specialists.length).padEnd(8);
    console.log(`  ${r.topology.padEnd(8)} ${dur} ${calls} ${agents} ${contextFlow[r.topology]}`);
  }

  // Highlight fastest and most LLM-efficient
  const fastest = results.reduce((a, b) => (a.totalDurationMs < b.totalDurationMs ? a : b));
  const fewestCalls = results.reduce((a, b) => (a.llmCallCount < b.llmCallCount ? a : b));
  printDivider();
  console.log(
    `  Fastest:        ${fastest.topology} (${(fastest.totalDurationMs / 1000).toFixed(1)}s)`,
  );
  console.log(`  Fewest LLM calls: ${fewestCalls.topology} (${fewestCalls.llmCallCount} calls)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ALL_TOPOLOGIES: TopologyName[] = ["chain", "star", "tree", "graph"];

async function main(): Promise<void> {
  // Parse --topology=<name> flag — default: run all four
  const flag = process.argv.find((a) => a.startsWith("--topology="));
  const selected = flag ? (flag.split("=")[1] as TopologyName) : null;

  if (selected && !ALL_TOPOLOGIES.includes(selected)) {
    console.error(`Unknown topology: "${selected}". Valid options: ${ALL_TOPOLOGIES.join(", ")}`);
    process.exit(1);
  }

  const toRun: TopologyName[] = selected ? [selected] : ALL_TOPOLOGIES;

  console.log("\n  Multi-Agent Coordination Topologies");
  console.log("  Task:", DEMO_TASK);
  console.log();

  const results: TopologyResult[] = [];

  for (const topology of toRun) {
    printTopologyHeader(topology);
    const result = await runTopology(DEMO_TASK, topology);
    printResult(result);
    results.push(result);
    console.log();
  }

  // Print comparison table when running more than one topology
  if (results.length > 1) {
    printComparisonTable(results);
  }

  console.log();
}

main().catch(console.error);
