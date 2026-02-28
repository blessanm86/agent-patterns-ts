import { z } from "zod/v4";
import { executeMetricTool, ALLOWED_TOOL_NAMES } from "./tools.js";
import type { DeclarativePlan, PlanStep, StepResult, PlanArtifact } from "./types.js";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────
//
// Validate the plan JSON the LLM produces. Two key .refine() calls:
//   1. All tool names must be in the allowed set
//   2. $ref indices can only reference previous steps (no forward refs)

const StepRefSchema = z
  .object({ $ref: z.string() })
  .refine((ref) => /^steps\[\d+\]\.result\./.test(ref.$ref), {
    message: '$ref must match pattern "steps[N].result.<path>"',
  });

const PlanStepSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.union([z.string(), StepRefSchema])),
  description: z.string(),
});

const DeclarativePlanSchema = z
  .object({
    goal: z.string(),
    steps: z.array(PlanStepSchema),
  })
  .refine(
    (plan) => plan.steps.every((step) => ALLOWED_TOOL_NAMES.includes(step.tool)),
    `Unknown tool name. Allowed: ${ALLOWED_TOOL_NAMES.join(", ")}`,
  )
  .refine((plan) => {
    for (let i = 0; i < plan.steps.length; i++) {
      for (const val of Object.values(plan.steps[i].args)) {
        if (typeof val === "object" && "$ref" in val) {
          const match = val.$ref.match(/^steps\[(\d+)\]/);
          if (match && parseInt(match[1], 10) >= i) return false;
        }
      }
    }
    return true;
  }, "$ref forward references are not allowed — steps can only reference earlier steps");

// ─── Reference Resolution ────────────────────────────────────────────────────
//
// Resolves "steps[0].result.metrics[2].name" against collected step results.
// Supports dot-path traversal with array index syntax: field[N].subfield

export function resolveRef(ref: string, stepResults: StepResult[]): string {
  // Parse step index: "steps[0].result.metrics[2].name" → index=0, path="metrics[2].name"
  const rootMatch = ref.match(/^steps\[(\d+)\]\.result\.(.+)$/);
  if (!rootMatch) {
    throw new Error(`Invalid $ref format: ${ref}`);
  }

  const stepIndex = parseInt(rootMatch[1], 10);
  const path = rootMatch[2];

  if (stepIndex >= stepResults.length) {
    throw new Error(
      `$ref references step ${stepIndex} but only ${stepResults.length} steps have executed`,
    );
  }

  const step = stepResults[stepIndex];
  if (step.error) {
    throw new Error(`$ref references step ${stepIndex} which failed: ${step.error}`);
  }

  // Walk the dot-path, handling array indices like "metrics[0].name"
  // Split on dots, then handle array indexing within each segment
  const segments = path.split(".");
  let current: unknown = step.result;

  for (const segment of segments) {
    if (current == null) {
      throw new Error(`$ref path "${ref}" hit null/undefined at segment "${segment}"`);
    }

    // Check for array index: "metrics[0]" → key="metrics", index=0
    const arrayMatch = segment.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      current = (current as Record<string, unknown>)[key];
      if (!Array.isArray(current)) {
        throw new Error(`$ref path "${ref}": "${key}" is not an array`);
      }
      current = current[index];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }

  if (current == null) {
    throw new Error(`$ref path "${ref}" resolved to null/undefined`);
  }

  // Coerce to string for tool args
  return typeof current === "string" ? current : JSON.stringify(current);
}

// ─── Step Summary ────────────────────────────────────────────────────────────
//
// One-line summary per tool — the "content" half of the dual return.
// The LLM sees this; the UI gets the full PlanArtifact.

export function summarizeStepResult(tool: string, result: unknown): string {
  const data = result as Record<string, unknown>;

  switch (tool) {
    case "list_metrics": {
      const metrics = data.metrics as Array<{ name: string }>;
      return `Found ${metrics?.length ?? 0} metrics: ${metrics?.map((m) => m.name).join(", ") ?? "none"}`;
    }
    case "query_metric":
      return `${data.metric}: current=${data.current}${data.unit ?? ""}`;
    case "check_threshold":
      return String(data.status ?? "check complete");
    default:
      return JSON.stringify(result).slice(0, 120);
  }
}

// ─── PlanExecutor ────────────────────────────────────────────────────────────
//
// Validates and executes declarative plans. Resolves $ref placeholders
// between steps, runs tools sequentially, and returns a full PlanArtifact.

export class PlanExecutor {
  /** Parse and validate a plan JSON string. Returns the plan or an error message. */
  validatePlan(
    planJson: string,
  ): { plan: DeclarativePlan; error?: undefined } | { plan?: undefined; error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(planJson);
    } catch {
      return { error: `Invalid JSON: ${planJson.slice(0, 100)}...` };
    }

    const result = DeclarativePlanSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join("; ");
      return { error: `Plan validation failed: ${issues}` };
    }

    return { plan: result.data as DeclarativePlan };
  }

  /** Execute a validated plan. Best-effort: continues on step errors. */
  async execute(plan: DeclarativePlan): Promise<PlanArtifact> {
    const startTime = performance.now();
    const stepResults: StepResult[] = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i] as PlanStep;
      const stepStart = performance.now();

      try {
        // Resolve $ref placeholders in args
        const resolvedArgs: Record<string, string> = {};
        for (const [key, value] of Object.entries(step.args)) {
          if (typeof value === "object" && "$ref" in value) {
            resolvedArgs[key] = resolveRef(value.$ref, stepResults);
          } else {
            resolvedArgs[key] = value as string;
          }
        }

        // Execute the tool
        const rawResult = executeMetricTool(step.tool, resolvedArgs);
        const parsed = JSON.parse(rawResult);

        stepResults.push({
          stepIndex: i,
          tool: step.tool,
          resolvedArgs,
          result: parsed,
          summary: summarizeStepResult(step.tool, parsed),
          durationMs: Math.round(performance.now() - stepStart),
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        stepResults.push({
          stepIndex: i,
          tool: step.tool,
          resolvedArgs: {},
          result: null,
          summary: `FAILED: ${error}`,
          durationMs: Math.round(performance.now() - stepStart),
          error,
        });
      }
    }

    return {
      goal: plan.goal,
      steps: stepResults,
      totalDurationMs: Math.round(performance.now() - startTime),
      stepsSucceeded: stepResults.filter((s) => !s.error).length,
      stepsFailed: stepResults.filter((s) => s.error).length,
    };
  }
}
