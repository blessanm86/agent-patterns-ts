import { trace, type Tracer } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  SimpleSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ExportResult } from "@opentelemetry/core";
import type { TraceSummary } from "./types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert OTel's [seconds, nanoseconds] HrTime tuple to milliseconds. */
function hrTimeToMs(hr: [number, number]): number {
  return hr[0] * 1000 + hr[1] / 1_000_000;
}

// ─── Pretty Console Exporter ────────────────────────────────────────────────
//
// Prints spans in a human-readable format as they complete. Child spans
// (those with a parentSpanId) are indented for visual hierarchy.
//
// Example output:
//   [TRACE] chat qwen2.5:7b (1,891ms, 512 in / 89 out, tool_calls)
//   [TRACE] execute_tool check_availability (2ms, ok)
//   [TRACE] chat qwen2.5:7b (1,102ms, 643 in / 124 out, stop)
// [TRACE] invoke_agent hotel-reservation (3,247ms total)

class PrettyConsoleExporter implements SpanExporter {
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      const durationMs = hrTimeToMs(span.duration);
      const hasParent = span.parentSpanContext !== undefined;
      const indent = hasParent ? "  " : "";
      const name = span.name;

      // Format depends on span type
      const attrs = span.attributes;
      if (attrs["gen_ai.operation.name"] === "chat") {
        // LLM call span — show duration, tokens, finish reason
        const inputTokens = attrs["gen_ai.usage.input_tokens"] ?? "?";
        const outputTokens = attrs["gen_ai.usage.output_tokens"] ?? "?";
        const finishReason = attrs["gen_ai.response.finish_reasons"] ?? "unknown";
        console.log(
          `${indent}[TRACE] ${name} (${durationMs.toLocaleString("en-US", { maximumFractionDigits: 0 })}ms, ${inputTokens} in / ${outputTokens} out, ${finishReason})`,
        );
      } else if (name.startsWith("execute_tool")) {
        // Tool execution span — show duration and status
        const status = attrs["tool.status"] ?? "ok";
        console.log(
          `${indent}[TRACE] ${name} (${durationMs.toLocaleString("en-US", { maximumFractionDigits: 0 })}ms, ${status})`,
        );
      } else {
        // Root/agent span — show total duration
        console.log(
          `${indent}[TRACE] ${name} (${durationMs.toLocaleString("en-US", { maximumFractionDigits: 0 })}ms total)`,
        );
      }
    }

    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

// ─── Trace Summary Collector ─────────────────────────────────────────────────
//
// Silently accumulates metrics from span attributes. Call getSummary() after
// an agent run to get aggregated stats: LLM calls, tool calls, tokens, cost.

export class TraceSummaryCollector implements SpanExporter {
  private llmCalls = 0;
  private toolCalls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private agentDurationMs = 0;

  // GPT-4o pricing as a reasonable reference point for cost estimation.
  // Ollama is free locally, but showing estimated cost helps developers
  // understand what production would cost with a cloud model.
  private static INPUT_COST_PER_TOKEN = 2.5 / 1_000_000; // $2.50 per 1M input tokens
  private static OUTPUT_COST_PER_TOKEN = 10.0 / 1_000_000; // $10.00 per 1M output tokens

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      const attrs = span.attributes;

      if (attrs["gen_ai.operation.name"] === "chat") {
        this.llmCalls++;
        this.inputTokens += (attrs["gen_ai.usage.input_tokens"] as number) ?? 0;
        this.outputTokens += (attrs["gen_ai.usage.output_tokens"] as number) ?? 0;
      } else if (span.name.startsWith("execute_tool")) {
        this.toolCalls++;
      } else if (span.name.startsWith("invoke_agent")) {
        // Root agent span — capture total duration
        this.agentDurationMs = hrTimeToMs(span.duration);
      }
    }

    resultCallback({ code: 0 });
  }

  /** Get aggregated trace summary for the last agent run. */
  getSummary(): TraceSummary {
    const estimatedCost =
      this.inputTokens * TraceSummaryCollector.INPUT_COST_PER_TOKEN +
      this.outputTokens * TraceSummaryCollector.OUTPUT_COST_PER_TOKEN;

    return {
      durationMs: this.agentDurationMs,
      llmCalls: this.llmCalls,
      toolCalls: this.toolCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCost,
    };
  }

  /** Reset all counters — call before each agent run. */
  reset(): void {
    this.llmCalls = 0;
    this.toolCalls = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.agentDurationMs = 0;
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

// ─── SDK Initialization ──────────────────────────────────────────────────────
//
// Creates a NodeTracerProvider with both exporters attached via
// SimpleSpanProcessor (immediate export, no batching — ideal for dev/demo).

export function initTracing(): {
  tracer: Tracer;
  collector: TraceSummaryCollector;
  shutdown: () => Promise<void>;
} {
  const collector = new TraceSummaryCollector();

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "hotel-reservation-agent",
    }),
    spanProcessors: [
      new SimpleSpanProcessor(new PrettyConsoleExporter()),
      new SimpleSpanProcessor(collector),
    ],
  });

  provider.register();

  const tracer = trace.getTracer("hotel-reservation-agent", "1.0.0");

  return {
    tracer,
    collector,
    shutdown: () => provider.shutdown(),
  };
}
