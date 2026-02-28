// ─── Declarative Plan Execution Evals ────────────────────────────────────────
//
// 4 groups:
//   1. Ref resolution (deterministic) — build a plan, execute, verify refs resolve
//   2. Validation (deterministic) — invalid plans must be rejected
//   3. LLM uses execute_plan (LLM-dependent) — agent produces a plan artifact
//   4. Comparison (LLM-dependent) — declarative uses fewer LLM calls

import { evalite, createScorer } from "evalite";
import { PlanExecutor } from "../executor.js";
import { runAgent } from "../agent.js";
import type { DeclarativePlan, PlanArtifact, AgentResult } from "../types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const executor = new PlanExecutor();

async function executePlan(plan: DeclarativePlan): Promise<PlanArtifact> {
  return executor.execute(plan);
}

type ValidationResult = { plan?: DeclarativePlan; error?: string };

// ─── Group 1: Ref Resolution (deterministic) ─────────────────────────────────

evalite("Ref resolution — list then query", {
  data: async () => [
    {
      input: {
        goal: "List compute metrics and query the first one",
        steps: [
          {
            tool: "list_metrics",
            args: { category: "compute" },
            description: "Get compute metrics",
          },
          {
            tool: "query_metric",
            args: { name: { $ref: "steps[0].result.metrics[0].name" } },
            description: "Query first metric",
          },
        ],
      } as DeclarativePlan,
    },
  ],
  task: async (input) => executePlan(input),
  scorers: [
    createScorer<DeclarativePlan, PlanArtifact>({
      name: "all steps succeed",
      scorer: ({ output }) => (output.stepsFailed === 0 && output.stepsSucceeded === 2 ? 1 : 0),
    }),
    createScorer<DeclarativePlan, PlanArtifact>({
      name: "ref resolved to real metric name",
      scorer: ({ output }) => {
        const step1Args = output.steps[1]?.resolvedArgs;
        return step1Args?.name === "cpu_usage" ? 1 : 0;
      },
    }),
  ],
});

evalite("Ref resolution — list, query, then check threshold", {
  data: async () => [
    {
      input: {
        goal: "List metrics, query CPU, check if above 80%",
        steps: [
          {
            tool: "list_metrics",
            args: { category: "compute" },
            description: "Get compute metrics",
          },
          {
            tool: "query_metric",
            args: { name: { $ref: "steps[0].result.metrics[0].name" } },
            description: "Query first metric",
          },
          {
            tool: "check_threshold",
            args: {
              metric_name: { $ref: "steps[0].result.metrics[0].name" },
              threshold: "80",
              operator: "gt",
            },
            description: "Check if above 80%",
          },
        ],
      } as DeclarativePlan,
    },
  ],
  task: async (input) => executePlan(input),
  scorers: [
    createScorer<DeclarativePlan, PlanArtifact>({
      name: "all 3 steps succeed",
      scorer: ({ output }) => (output.stepsFailed === 0 && output.stepsSucceeded === 3 ? 1 : 0),
    }),
  ],
});

// ─── Group 2: Validation (deterministic) ─────────────────────────────────────

evalite("Validation — bad tool name rejected", {
  data: async () => [
    {
      input: JSON.stringify({
        goal: "test",
        steps: [{ tool: "nonexistent_tool", args: {}, description: "bad" }],
      }),
    },
  ],
  task: async (input) => executor.validatePlan(input) as ValidationResult,
  scorers: [
    createScorer<string, ValidationResult>({
      name: "rejected with error",
      scorer: ({ output }) => (output.error ? 1 : 0),
    }),
  ],
});

evalite("Validation — forward ref rejected", {
  data: async () => [
    {
      input: JSON.stringify({
        goal: "test",
        steps: [
          {
            tool: "query_metric",
            args: { name: { $ref: "steps[1].result.metrics[0].name" } },
            description: "forward ref",
          },
          { tool: "list_metrics", args: {}, description: "list" },
        ],
      }),
    },
  ],
  task: async (input) => executor.validatePlan(input) as ValidationResult,
  scorers: [
    createScorer<string, ValidationResult>({
      name: "rejected with error",
      scorer: ({ output }) => (output.error ? 1 : 0),
    }),
  ],
});

evalite("Validation — bad JSON rejected", {
  data: async () => [{ input: "not json at all {{" }],
  task: async (input) => executor.validatePlan(input) as ValidationResult,
  scorers: [
    createScorer<string, ValidationResult>({
      name: "rejected with error",
      scorer: ({ output }) => (output.error ? 1 : 0),
    }),
  ],
});

// ─── Group 3: LLM uses execute_plan (LLM-dependent) ─────────────────────────

evalite("LLM — produces plan artifact", {
  data: async () => [
    { input: "List all compute metrics and query the first one" },
    { input: "Check if CPU usage is above 90%" },
  ],
  task: async (input) => runAgent(input, [], "declarative"),
  scorers: [
    createScorer<string, AgentResult>({
      name: "has artifact",
      scorer: ({ output }) => (output.artifact ? 1 : 0),
    }),
    createScorer<string, AgentResult>({
      name: "steps succeeded",
      scorer: ({ output }) => {
        if (!output.artifact) return 0;
        return output.artifact.stepsFailed === 0 ? 1 : 0;
      },
    }),
  ],
});

// ─── Group 4: Comparison (LLM-dependent) ─────────────────────────────────────

type ComparisonResult = { declarative: AgentResult["stats"]; individual: AgentResult["stats"] };

evalite("Comparison — declarative uses fewer LLM calls", {
  data: async () => [{ input: "List all compute metrics and query CPU usage" }],
  task: async (input) => {
    const declarative = await runAgent(input, [], "declarative");
    const individual = await runAgent(input, [], "individual");
    return { declarative: declarative.stats, individual: individual.stats };
  },
  scorers: [
    createScorer<string, ComparisonResult>({
      name: "fewer LLM calls",
      scorer: ({ output }) => (output.declarative.llmCalls <= output.individual.llmCalls ? 1 : 0),
    }),
  ],
});
