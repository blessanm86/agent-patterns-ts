// ─── Declarative Plan Types ──────────────────────────────────────────────────
//
// Types for the declarative plan execution pattern. Steps can reference
// prior step outputs via $ref placeholders, resolved at runtime.

import type { Message } from "../shared/types.js";

// ─── Plan Structure ──────────────────────────────────────────────────────────

/** A reference to a prior step's output: { $ref: "steps[0].result.metrics[0].name" } */
export interface StepRef {
  $ref: string;
}

/** A single step in a declarative plan */
export interface PlanStep {
  tool: string;
  args: Record<string, string | StepRef>;
  description: string;
}

/** A full declarative plan emitted by the LLM in a single tool call */
export interface DeclarativePlan {
  goal: string;
  steps: PlanStep[];
}

// ─── Execution Results ───────────────────────────────────────────────────────

/** Per-step execution record */
export interface StepResult {
  stepIndex: number;
  tool: string;
  resolvedArgs: Record<string, string>;
  result: unknown;
  summary: string;
  durationMs: number;
  error?: string;
}

/** Full plan execution artifact — the structured output for UI display */
export interface PlanArtifact {
  goal: string;
  steps: StepResult[];
  totalDurationMs: number;
  stepsSucceeded: number;
  stepsFailed: number;
}

// ─── Agent Configuration ─────────────────────────────────────────────────────

export type ExecutionMode = "declarative" | "individual";

export interface AgentResult {
  messages: Message[];
  artifact: PlanArtifact | null;
  stats: {
    mode: ExecutionMode;
    llmCalls: number;
    toolCalls: number;
    totalDurationMs: number;
  };
}
