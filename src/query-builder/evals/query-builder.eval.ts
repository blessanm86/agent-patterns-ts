// ─── Query Builder Pattern Evals ─────────────────────────────────────────────
//
// Each scenario runs against BOTH raw and builder modes.
// The score difference quantifies the query builder pattern's value:
//   - Builder: structured params → always valid syntax → high success rate
//   - Raw: LLM writes query strings → frequent syntax errors → lower success rate
//
// Scoring: 1 if the agent produced a successful query result, 0 if all queries failed.

import { evalite, createScorer } from "evalite";
import { runAgent } from "../agent.js";
import type { QueryMode } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasSuccessfulQuery(mode: QueryMode) {
  return async (input: string) => {
    const result = await runAgent(input, [], mode);
    return result.queryStats;
  };
}

const querySucceeded = createScorer<string, { totalQueries: number; successfulQueries: number }>({
  name: "query succeeded",
  scorer: ({ output }) => (output.successfulQueries > 0 ? 1 : 0),
});

// ─── Scenario 1: Simple Metric Lookup ───────────────────────────────────────

evalite("Raw — simple metric count", {
  data: async () => [
    { input: "How many total HTTP requests has the api-gateway handled in the last hour?" },
  ],
  task: hasSuccessfulQuery("raw"),
  scorers: [querySucceeded],
});

evalite("Builder — simple metric count", {
  data: async () => [
    { input: "How many total HTTP requests has the api-gateway handled in the last hour?" },
  ],
  task: hasSuccessfulQuery("builder"),
  scorers: [querySucceeded],
});

// ─── Scenario 2: Filtered Query (5xx Errors) ───────────────────────────────

evalite("Raw — filtered query (500 status)", {
  data: async () => [{ input: "How many 500 errors has the checkout-service returned?" }],
  task: hasSuccessfulQuery("raw"),
  scorers: [querySucceeded],
});

evalite("Builder — filtered query (500 status)", {
  data: async () => [{ input: "How many 500 errors has the checkout-service returned?" }],
  task: hasSuccessfulQuery("builder"),
  scorers: [querySucceeded],
});

// ─── Scenario 3: Aggregation with Group By ──────────────────────────────────

evalite("Raw — group by (latency by service)", {
  data: async () => [{ input: "What is the average request latency grouped by service?" }],
  task: hasSuccessfulQuery("raw"),
  scorers: [querySucceeded],
});

evalite("Builder — group by (latency by service)", {
  data: async () => [{ input: "What is the average request latency grouped by service?" }],
  task: hasSuccessfulQuery("builder"),
  scorers: [querySucceeded],
});

// ─── Scenario 4: Time Range Query ──────────────────────────────────────────

evalite("Raw — time range (last 15 minutes)", {
  data: async () => [
    { input: "Show me the request count for the last 15 minutes for search-service." },
  ],
  task: hasSuccessfulQuery("raw"),
  scorers: [querySucceeded],
});

evalite("Builder — time range (last 15 minutes)", {
  data: async () => [
    { input: "Show me the request count for the last 15 minutes for search-service." },
  ],
  task: hasSuccessfulQuery("builder"),
  scorers: [querySucceeded],
});

// ─── Scenario 5: Multi-Filter Query ────────────────────────────────────────

evalite("Raw — multi-filter (service + method + status)", {
  data: async () => [{ input: "Count POST requests to checkout-service that returned 500." }],
  task: hasSuccessfulQuery("raw"),
  scorers: [querySucceeded],
});

evalite("Builder — multi-filter (service + method + status)", {
  data: async () => [{ input: "Count POST requests to checkout-service that returned 500." }],
  task: hasSuccessfulQuery("builder"),
  scorers: [querySucceeded],
});

// ─── Scenario 6: Rate Calculation ──────────────────────────────────────────

evalite("Raw — rate calculation", {
  data: async () => [{ input: "What is the request rate for the api-gateway?" }],
  task: hasSuccessfulQuery("raw"),
  scorers: [querySucceeded],
});

evalite("Builder — rate calculation", {
  data: async () => [{ input: "What is the request rate for the api-gateway?" }],
  task: hasSuccessfulQuery("builder"),
  scorers: [querySucceeded],
});

// ─── Scenario 7: Percentile Query ──────────────────────────────────────────

evalite("Raw — p99 latency", {
  data: async () => [{ input: "What is the p99 latency for payment-gateway by method?" }],
  task: hasSuccessfulQuery("raw"),
  scorers: [querySucceeded],
});

evalite("Builder — p99 latency", {
  data: async () => [{ input: "What is the p99 latency for payment-gateway by method?" }],
  task: hasSuccessfulQuery("builder"),
  scorers: [querySucceeded],
});

// ─── Scenario 8: CPU Usage (Different Metric) ─────────────────────────────

evalite("Raw — CPU usage by service", {
  data: async () => [{ input: "Which service has the highest max CPU usage?" }],
  task: hasSuccessfulQuery("raw"),
  scorers: [querySucceeded],
});

evalite("Builder — CPU usage by service", {
  data: async () => [{ input: "Which service has the highest max CPU usage?" }],
  task: hasSuccessfulQuery("builder"),
  scorers: [querySucceeded],
});
