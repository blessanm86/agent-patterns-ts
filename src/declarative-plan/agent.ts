import ollama from "ollama";
import { metricTools, allTools, executeMetricTool } from "./tools.js";
import { PlanExecutor } from "./executor.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import type { ExecutionMode, AgentResult, PlanArtifact } from "./types.js";

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a system metrics monitoring assistant. You help users explore, query, and check thresholds on system metrics.

You have access to these monitoring tools:
- list_metrics(category?) — browse the metric catalog (categories: compute, storage, network)
- query_metric(name, period?, host?) — get time-series data for a specific metric
- check_threshold(metric_name, threshold, operator) — check if a metric exceeds a threshold (operators: gt, lt, gte, lte, eq)

You also have access to a powerful meta-tool:
- execute_plan(plan) — execute a multi-step plan in a single call, where steps can reference prior step outputs

IMPORTANT: When the user asks a question that requires multiple steps (e.g., "list metrics then query CPU"), prefer using execute_plan to do it all at once. This avoids unnecessary round-trips.

The execute_plan tool accepts a "plan" parameter which is a JSON string with this structure:
{
  "goal": "description of what we're doing",
  "steps": [
    {
      "tool": "list_metrics",
      "args": { "category": "compute" },
      "description": "Get compute metrics"
    },
    {
      "tool": "query_metric",
      "args": { "name": { "$ref": "steps[0].result.metrics[0].name" } },
      "description": "Query the first compute metric"
    }
  ]
}

The $ref syntax lets later steps reference earlier step outputs. The path format is: steps[N].result.<path>
For example, steps[0].result.metrics[0].name resolves to the name field of the first metric returned by step 0.

Always explain what you found after the tools execute.`;

// ─── Agent Loop ──────────────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  history: Message[],
  mode: ExecutionMode = "declarative",
): Promise<AgentResult> {
  const startTime = performance.now();
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // In individual mode, exclude the execute_plan meta-tool
  const tools = mode === "declarative" ? allTools : metricTools;

  let llmCalls = 0;
  let toolCalls = 0;
  let artifact: PlanArtifact | null = null;

  // ── ReAct Loop ─────────────────────────────────────────────────────────────

  while (true) {
    llmCalls++;
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done reasoning
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      toolCalls++;

      if (name === "execute_plan") {
        // ── Meta-tool: validate + execute the declarative plan ──────────────
        const planJson = (args as Record<string, string>).plan;
        const executor = new PlanExecutor();
        const validation = executor.validatePlan(planJson);

        if (validation.error) {
          console.log(`\n  ❌ Plan validation failed: ${validation.error}`);
          messages.push({ role: "tool", content: JSON.stringify({ error: validation.error }) });
          continue;
        }

        // validation.error is checked above, so plan is guaranteed to exist
        const plan = validation.plan!;
        console.log(`\n  📋 Executing plan: ${plan.goal}`);
        console.log(`     Steps:`);
        plan.steps.forEach((step, i) => {
          const argStr = Object.entries(step.args)
            .map(([k, v]) => (typeof v === "object" ? `${k}=$ref` : `${k}=${v}`))
            .join(", ");
          console.log(`     ${i + 1}. ${step.tool}(${argStr}) — ${step.description}`);
        });

        artifact = await executor.execute(plan);

        // Log each step result
        for (const step of artifact.steps) {
          if (step.error) {
            console.log(`\n  ❌ Step ${step.stepIndex + 1}: ${step.tool} — FAILED: ${step.error}`);
          } else {
            logToolCall(step.tool, step.resolvedArgs, JSON.stringify(step.result));
          }
        }

        // Push concise summary for the LLM (not the full artifact)
        const summary = artifact.steps
          .map((s, i) => `Step ${i + 1} (${s.tool}): ${s.summary}`)
          .join("\n");
        messages.push({
          role: "tool",
          content: `Plan executed: ${artifact.stepsSucceeded}/${artifact.steps.length} steps succeeded.\n${summary}`,
        });
      } else {
        // ── Individual tool call ─────────────────────────────────────────────
        const result = executeMetricTool(name, args as Record<string, string>);
        logToolCall(name, args as Record<string, string>, result);
        messages.push({ role: "tool", content: result });
      }
    }
  }

  return {
    messages,
    artifact,
    stats: {
      mode,
      llmCalls,
      toolCalls,
      totalDurationMs: Math.round(performance.now() - startTime),
    },
  };
}
