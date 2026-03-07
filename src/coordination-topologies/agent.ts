// ─── Multi-Agent Coordination Topologies ─────────────────────────────────────
//
// Four structural patterns for connecting agents:
//
//   chain  — sequential pipeline, each agent sees all prior outputs
//   star   — parallel fan-out to isolated specialists, synthesizer gathers
//   tree   — two-level hierarchy: domain leads + leaf workers + director
//   graph  — directed acyclic graph, agents start when dependencies complete
//
// The key insight: all four topologies share the same primitive — runSpecialist().
// Topology only determines WHEN a specialist runs and WHAT context it receives.

import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message, ToolDefinition } from "../shared/types.js";
import {
  requirementsTools,
  pricingTools,
  marketingTools,
  technicalTools,
  executeRequirementsTool,
  executePricingTool,
  executeMarketingTool,
  executeTechnicalTool,
} from "./tools.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TopologyName = "chain" | "star" | "tree" | "graph";

export interface SpecialistResult {
  name: string;
  output: string;
  durationMs: number;
  toolCallCount: number;
}

export interface TopologyResult {
  topology: TopologyName;
  output: string;
  specialists: SpecialistResult[];
  totalDurationMs: number;
  llmCallCount: number;
}

// ─── Specialist Profiles ──────────────────────────────────────────────────────
//
// Each profile bundles the three things a specialist needs:
//   - systemPrompt: its domain expertise and output format
//   - tools: the scoped tool set it's allowed to call
//   - executeTool: the dispatcher that runs the actual mock implementations

type ToolExecutor = (name: string, args: Record<string, string>) => string;

interface SpecialistProfile {
  name: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  executeTool: ToolExecutor;
}

const SPECIALISTS: Record<string, SpecialistProfile> = {
  requirements: {
    name: "Requirements Analyst",
    systemPrompt: `You are a product requirements analyst. Analyze the product's features and target customer.

Use your tools (analyze_product_features and identify_target_customer) to research the product.
After calling tools, provide a concise requirements summary covering:
- Key differentiators (2–3 bullet points)
- Target customer profile (1–2 sentences)
- Launch readiness assessment (1 sentence)

Keep your final response under 150 words.`,
    tools: requirementsTools,
    executeTool: executeRequirementsTool,
  },

  pricing: {
    name: "Pricing Analyst",
    systemPrompt: `You are a pricing analyst. Research competitors and recommend a pricing strategy.

Use your tools (research_competitor_prices and recommend_pricing_strategy) to analyze the market.
After calling tools, provide a concise pricing report covering:
- Top 2–3 competitors and their prices
- Recommended pricing strategy
- Early-bird and standard launch prices

Keep your final response under 150 words.`,
    tools: pricingTools,
    executeTool: executePricingTool,
  },

  marketing: {
    name: "Marketing Writer",
    systemPrompt: `You are a product marketing copywriter. Create compelling messaging and select launch channels.

Use your tools (generate_product_messaging and select_launch_channels) to craft the launch plan.
After calling tools, provide:
- Product headline and tagline
- Top 3 key messages
- Top 2 launch channels with rationale

Keep your final response under 150 words.`,
    tools: marketingTools,
    executeTool: executeMarketingTool,
  },

  technical: {
    name: "Technical Reviewer",
    systemPrompt: `You are a technical reviewer. Validate product claims and identify compliance requirements.

Use your tools (validate_technical_claims and check_compliance_requirements) to audit the product.
After calling tools, provide:
- Verified claims (what's solid)
- Claims requiring disclaimers (be specific)
- Critical compliance certifications needed

Keep your final response under 150 words.`,
    tools: technicalTools,
    executeTool: executeTechnicalTool,
  },

  // Used in the graph topology for the "audience" node — same tools as
  // requirements analyst but steered toward customer profiling.
  audience: {
    name: "Audience Researcher",
    systemPrompt: `You are a customer research specialist. Your ONLY job is to profile the target customer.

Use the identify_target_customer tool (not analyze_product_features) to research the customer segment.
After the tool call, provide:
- Primary customer persona (who they are, 1–2 sentences)
- Key pain points this product solves (2–3 bullet points)
- Where they discover new products (1–2 channels)

Keep your final response under 120 words.`,
    tools: requirementsTools,
    executeTool: executeRequirementsTool,
  },

  // Used in the graph topology for the "brief" (final synthesis) node.
  // Empty tools array — the model generates text directly without tool calls.
  synthesizer: {
    name: "Launch Brief Synthesizer",
    systemPrompt: `You are a product launch director. Synthesize the specialist reports into a polished launch brief.

Do NOT call any tools — synthesize what you have been given.

Structure your response exactly as:
1. Product Overview (2 sentences)
2. Target Audience (2 sentences)
3. Pricing & Positioning (2 sentences)
4. Key Messages (3 bullet points)
5. Technical & Compliance Notes (2 sentences)

Keep under 200 words total. Be specific — include actual numbers and channel names.`,
    tools: [],
    executeTool: () => "",
  },
};

// ─── LLM call counter (reset per topology run) ───────────────────────────────

let _llmCalls = 0;

// ─── Core: Run a Single Specialist ───────────────────────────────────────────
//
// This is the shared primitive used by ALL four topologies.
// The topology only determines WHEN this runs and WHAT context is passed.
//
// `context` is prepended to the task as "Prior analysis" — it lets
// upstream agents' outputs flow into downstream agents without modifying
// the specialist profile itself.

const MAX_ITERATIONS = 6;

async function runSpecialist(
  profileKey: string,
  task: string,
  context = "",
): Promise<SpecialistResult> {
  const profile = SPECIALISTS[profileKey];
  const start = Date.now();
  let toolCallCount = 0;

  const contextualTask = context
    ? `${task}\n\n---\nContext from prior analysis:\n${context}`
    : task;

  const messages: Message[] = [{ role: "user", content: contextualTask }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    _llmCalls++;

    const chatOptions: Parameters<typeof ollama.chat>[0] = {
      model: MODEL,
      messages,
      // Only pass tools if the profile has them — empty tools array confuses some models
      ...(profile.tools.length > 0 && { tools: profile.tools }),
    };

    // @ts-expect-error — system not in ChatRequest types but works at runtime
    chatOptions.system = profile.systemPrompt;

    const response = await ollama.chat(chatOptions);
    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → specialist is done
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return {
        name: profile.name,
        output: assistantMessage.content ?? "",
        durationMs: Date.now() - start,
        toolCallCount,
      };
    }

    // Execute tool calls
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = profile.executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 120 });
      toolCallCount++;
      messages.push({ role: "tool", content: result });
    }
  }

  // Fallback: return last assistant message if max iterations hit
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  return {
    name: profile.name,
    output: last?.content ?? "[Specialist reached max iterations without a final response]",
    durationMs: Date.now() - start,
    toolCallCount,
  };
}

// Helper: a single LLM call with no tools — used for orchestrator/synthesis steps
async function llmCall(systemPrompt: string, userMessage: string): Promise<string> {
  _llmCalls++;
  const response = await ollama.chat({
    model: MODEL,
    // @ts-expect-error
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  return response.message.content ?? "";
}

// ─── Topology 1: Chain ────────────────────────────────────────────────────────
//
//   Requirements → Pricing → Marketing → Technical
//
// Each specialist receives the original task PLUS all prior specialists'
// outputs as accumulated context. Information flows forward; every agent
// can see and build on what came before.
//
// Error propagation: LINEAR. A flawed output at step N taints steps N+1
// through end. 0.95^4 = 81% — a 95%-reliable per-step chain is only 81%
// reliable end-to-end across 4 steps.
//
// Use when: pipeline has strict sequential dependencies and later steps
// genuinely need the full output of every earlier step.

export async function runChain(task: string): Promise<TopologyResult> {
  _llmCalls = 0;
  const start = Date.now();
  const specialists: SpecialistResult[] = [];
  let accumulatedContext = "";

  console.log("\n  [1/4] Requirements Analyst...");
  const req = await runSpecialist("requirements", task);
  specialists.push(req);
  accumulatedContext += `[Requirements Analysis]\n${req.output}`;

  console.log("  [2/4] Pricing Analyst...");
  const pricing = await runSpecialist("pricing", task, accumulatedContext);
  specialists.push(pricing);
  accumulatedContext += `\n\n[Pricing Analysis]\n${pricing.output}`;

  console.log("  [3/4] Marketing Writer...");
  const marketing = await runSpecialist("marketing", task, accumulatedContext);
  specialists.push(marketing);
  accumulatedContext += `\n\n[Marketing Plan]\n${marketing.output}`;

  console.log("  [4/4] Technical Reviewer...");
  const technical = await runSpecialist("technical", task, accumulatedContext);
  specialists.push(technical);
  accumulatedContext += `\n\n[Technical Review]\n${technical.output}`;

  return {
    topology: "chain",
    output: accumulatedContext,
    specialists,
    totalDurationMs: Date.now() - start,
    llmCallCount: _llmCalls,
  };
}

// ─── Topology 2: Star ─────────────────────────────────────────────────────────
//
//   [Requirements, Pricing, Marketing, Technical] ─── parallel ───> Synthesizer
//
// All specialists run in parallel with completely ISOLATED context — they
// cannot see each other's work. The synthesizer makes one final LLM call
// to combine all results.
//
// Error propagation: CONTAINED. One failing specialist doesn't corrupt others.
// The synthesizer acts as a circuit breaker — it can spot inconsistencies
// across specialist reports. Google DeepMind measured 4.4x error amplification
// for centralized (star) vs 17.2x for uncoordinated (bag-of-agents).
//
// Use when: sub-tasks are independent and maximum latency reduction matters.

export async function runStar(task: string): Promise<TopologyResult> {
  _llmCalls = 0;
  const start = Date.now();

  console.log("\n  All 4 specialists running in parallel...");

  // Parallel fan-out — NO shared context between specialists
  const [req, pricing, marketing, technical] = await Promise.all([
    runSpecialist("requirements", task),
    runSpecialist("pricing", task),
    runSpecialist("marketing", task),
    runSpecialist("technical", task),
  ]);

  const specialists = [req, pricing, marketing, technical];

  // Print completions (they all finished above, just log them)
  for (const s of specialists) {
    console.log(`    done: ${s.name} (${s.toolCallCount} tools, ${s.durationMs}ms)`);
  }

  console.log("  Orchestrator synthesizing...");

  const reportsBlock = specialists.map((s) => `### ${s.name}\n${s.output}`).join("\n\n");

  const output = await llmCall(
    "You are a product launch director. Combine the specialist reports into a concise launch plan. " +
      "Structure: 1) Product Overview, 2) Pricing Strategy, 3) Key Messages, 4) Technical Notes. Under 200 words.",
    `Task: ${task}\n\nSpecialist Reports:\n${reportsBlock}`,
  );

  return {
    topology: "star",
    output,
    specialists,
    totalDurationMs: Date.now() - start,
    llmCallCount: _llmCalls,
  };
}

// ─── Topology 3: Tree ─────────────────────────────────────────────────────────
//
//             Director
//           /           \
//   Strategy Lead    Execution Lead   ← both run in parallel
//   (Req + Pricing)  (Marketing + Tech)
//
// Two domain leads run in parallel, each coordinating 2 leaf workers.
// Each domain lead synthesizes its specialists' outputs into a domain report.
// The Director synthesizes domain reports into the final plan.
//
// Error propagation: BIDIRECTIONAL. Bad decomposition cascades down to leaves;
// a leaf failure blocks the domain lead's synthesis. A mid-level failure
// orphans its entire subtree. MultiAgentBench found tree topology has the
// highest token consumption and lowest coordination scores.
//
// Use when: the problem has clear natural domain hierarchies and subdomain
// complexity genuinely warrants an extra coordination layer.

async function runDomain(
  domainName: string,
  specialistKeys: string[],
  task: string,
): Promise<SpecialistResult> {
  const start = Date.now();

  // Each leaf specialist runs with only the original task — domain isolation
  // means they don't see the other domain's work (no context contamination).
  const results = await Promise.all(specialistKeys.map((key) => runSpecialist(key, task)));
  for (const r of results) {
    console.log(`      done: ${r.name} (${r.toolCallCount} tools, ${r.durationMs}ms)`);
  }

  // Domain lead synthesizes its specialists into a domain brief
  const teamOutputs = results.map((r) => `[${r.name}]\n${r.output}`).join("\n\n");
  const synthesis = await llmCall(
    `You are the ${domainName} domain lead. Synthesize your specialists' reports into a focused domain brief. Under 120 words.`,
    `Task: ${task}\n\nSpecialist reports:\n${teamOutputs}`,
  );

  return {
    name: `${domainName} Domain Lead`,
    output: synthesis,
    durationMs: Date.now() - start,
    toolCallCount: results.reduce((n, r) => n + r.toolCallCount, 0),
  };
}

export async function runTree(task: string): Promise<TopologyResult> {
  _llmCalls = 0;
  const start = Date.now();

  console.log("\n  Strategy Domain (Requirements + Pricing) running in parallel with");
  console.log("  Execution Domain (Marketing + Technical)...\n");

  // Two domain leads run in parallel — each manages its own specialist pair
  const [strategy, execution] = await Promise.all([
    runDomain("Strategy", ["requirements", "pricing"], task),
    runDomain("Execution", ["marketing", "technical"], task),
  ]);

  const specialists = [strategy, execution];

  console.log(`    done: ${strategy.name} (${strategy.durationMs}ms)`);
  console.log(`    done: ${execution.name} (${execution.durationMs}ms)`);
  console.log("  Director synthesizing...");

  const domainReports = `[Strategy Domain]\n${strategy.output}\n\n[Execution Domain]\n${execution.output}`;

  const output = await llmCall(
    "You are a product director. Combine the domain reports into a final launch plan. " +
      "Structure: Overview, Strategy, Execution Plan. Under 200 words.",
    `Task: ${task}\n\nDomain Reports:\n${domainReports}`,
  );

  return {
    topology: "tree",
    output,
    specialists,
    totalDurationMs: Date.now() - start,
    llmCallCount: _llmCalls,
  };
}

// ─── Topology 4: Graph (DAG) ──────────────────────────────────────────────────
//
//   requirements ───────────────────────────────→ brief
//        │                                           ↑
//        ├──→ pricing ──→ copy ───────────────────── │
//        └──→ technical ──────────────────────────── │
//   audience ──────→ copy ──────────────────────────
//
//   Wave 1: [requirements, audience]    ← no dependencies
//   Wave 2: [pricing, technical]        ← depend on requirements
//   Wave 3: [copy]                      ← depends on pricing + audience
//   Wave 4: [brief]                     ← depends on copy + technical
//
// Each node runs as soon as ALL its dependencies are satisfied — giving
// maximum safe parallelism without coupling unrelated work.
//
// Context is SURGICAL: each node receives only its direct dependencies'
// outputs, not the entire accumulated history. This prevents context
// bloat and targets information precisely.
//
// Error propagation: CONTAINED TO DEPENDENTS. An upstream failure only
// affects nodes that depend on it — independent branches are unaffected.
//
// Use when: tasks have complex, non-linear dependencies that benefit from
// targeted context passing rather than full history accumulation.

interface GraphNode {
  id: string;
  specialistKey: string;
  dependencies: string[];
  contextBuilder?: (results: Map<string, SpecialistResult>) => string;
}

const LAUNCH_GRAPH: GraphNode[] = [
  // Wave 1: independent nodes — run immediately
  {
    id: "requirements",
    specialistKey: "requirements",
    dependencies: [],
  },
  {
    id: "audience",
    specialistKey: "audience",
    dependencies: [],
  },

  // Wave 2: depend on requirements
  {
    id: "pricing",
    specialistKey: "pricing",
    dependencies: ["requirements"],
    contextBuilder: (results) =>
      `Product requirements context:\n${results.get("requirements")?.output ?? ""}`,
  },
  {
    id: "technical",
    specialistKey: "technical",
    dependencies: ["requirements"],
    contextBuilder: (results) =>
      `Requirements to validate against:\n${results.get("requirements")?.output ?? ""}`,
  },

  // Wave 3: depends on pricing AND audience
  {
    id: "copy",
    specialistKey: "marketing",
    dependencies: ["pricing", "audience"],
    contextBuilder: (results) => {
      const pricing = results.get("pricing")?.output ?? "";
      const audience = results.get("audience")?.output ?? "";
      return `Pricing context:\n${pricing}\n\nAudience context:\n${audience}`;
    },
  },

  // Wave 4: depends on copy AND technical
  {
    id: "brief",
    specialistKey: "synthesizer",
    dependencies: ["copy", "technical"],
    contextBuilder: (results) => {
      const copy = results.get("copy")?.output ?? "";
      const technical = results.get("technical")?.output ?? "";
      return `Approved marketing copy:\n${copy}\n\nTechnical review notes:\n${technical}`;
    },
  },
];

export async function runGraph(task: string): Promise<TopologyResult> {
  _llmCalls = 0;
  const start = Date.now();

  const completed = new Map<string, SpecialistResult>();
  const allSpecialists: SpecialistResult[] = [];
  let wave = 0;

  while (completed.size < LAUNCH_GRAPH.length) {
    // Find all nodes whose dependencies are fully satisfied
    const ready = LAUNCH_GRAPH.filter(
      (node) => !completed.has(node.id) && node.dependencies.every((dep) => completed.has(dep)),
    );

    if (ready.length === 0) break; // guard against malformed graph

    wave++;
    const labels = ready.map((n) => n.id).join(", ");
    console.log(`\n  Wave ${wave}: [${labels}] running in parallel...`);

    // Run all ready nodes in parallel
    const waveResults = await Promise.all(
      ready.map((node) => {
        const context = node.contextBuilder ? node.contextBuilder(completed) : "";
        return runSpecialist(node.specialistKey, task, context).then((result) => ({
          nodeId: node.id,
          // Tag the result with the node ID so the display shows graph structure
          result: { ...result, name: `${result.name} [${node.id}]` },
        }));
      }),
    );

    for (const { nodeId, result } of waveResults) {
      completed.set(nodeId, result);
      allSpecialists.push(result);
      console.log(
        `    done: ${result.name} (${result.toolCallCount} tools, ${result.durationMs}ms)`,
      );
    }
  }

  const brief = completed.get("brief");

  return {
    topology: "graph",
    output: brief?.output ?? "[Graph did not produce a final brief]",
    specialists: allSpecialists,
    totalDurationMs: Date.now() - start,
    llmCallCount: _llmCalls,
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function runTopology(task: string, topology: TopologyName): Promise<TopologyResult> {
  switch (topology) {
    case "chain":
      return runChain(task);
    case "star":
      return runStar(task);
    case "tree":
      return runTree(task);
    case "graph":
      return runGraph(task);
  }
}
