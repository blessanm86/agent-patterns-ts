// ─── Eval: Repository Mapping Quality ────────────────────────────────────────
//
// Tests three aspects of the repo map pipeline:
//   1. Map completeness — does the map include key files?
//   2. PageRank ordering — are hub files ranked higher than leaf files?
//   3. Personalization — does boosting a file change the ranking?

import * as path from "path";
import { fileURLToPath } from "url";
import { evalite, createScorer } from "evalite";
import { generateRepoMap } from "../repo-map.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleProjectDir = path.join(__dirname, "..", "sample-project");

// ─── Eval 1: Map includes key files ─────────────────────────────────────────

evalite("Repo Map — includes key structural files", {
  data: async () => [
    { input: "order-service.ts should appear (highest connectivity)" },
    { input: "auth.ts should appear (uses validators + user model)" },
    { input: "index.ts should appear (app entry point)" },
  ],
  task: async () => {
    const { map } = generateRepoMap({
      rootDir: sampleProjectDir,
      tokenBudget: 2048,
      personalizedFiles: [],
    });
    return map;
  },
  scorers: [
    createScorer<string, string>({
      name: "order-service.ts in map",
      scorer: ({ output }) => (output.includes("order-service.ts") ? 1 : 0),
    }),
    createScorer<string, string>({
      name: "auth.ts in map",
      scorer: ({ output }) => (output.includes("auth.ts") ? 1 : 0),
    }),
    createScorer<string, string>({
      name: "index.ts in map",
      scorer: ({ output }) => (output.includes("index.ts") ? 1 : 0),
    }),
  ],
});

// ─── Eval 2: PageRank ranks hubs above leaves ───────────────────────────────

evalite("Repo Map — PageRank ranks connected files higher", {
  data: async () => [
    {
      input: "order-service should rank above formatters (more connections)",
    },
  ],
  task: async () => {
    const { ranked } = generateRepoMap({
      rootDir: sampleProjectDir,
      tokenBudget: 2048,
      personalizedFiles: [],
    });
    return ranked.map((r) => r.filePath);
  },
  scorers: [
    createScorer<string, string[]>({
      name: "order-service ranks above formatters",
      scorer: ({ output }) => {
        const orderIdx = output.findIndex((f) => f.includes("order-service"));
        const formattersIdx = output.findIndex((f) => f.includes("formatters"));
        if (orderIdx === -1 || formattersIdx === -1) return 0;
        return orderIdx < formattersIdx ? 1 : 0;
      },
    }),
    createScorer<string, string[]>({
      name: "auth ranks above formatters",
      scorer: ({ output }) => {
        const authIdx = output.findIndex((f) => f.includes("auth"));
        const formattersIdx = output.findIndex((f) => f.includes("formatters"));
        if (authIdx === -1 || formattersIdx === -1) return 0;
        return authIdx < formattersIdx ? 1 : 0;
      },
    }),
  ],
});

// ─── Eval 3: Personalization boosts targeted files ──────────────────────────

evalite("Repo Map — personalization boosts targeted files", {
  data: async () => [
    {
      input: "Boosting validators.ts should move it up in ranking",
    },
  ],
  task: async () => {
    const baseline = generateRepoMap({
      rootDir: sampleProjectDir,
      tokenBudget: 2048,
      personalizedFiles: [],
    });
    const boosted = generateRepoMap({
      rootDir: sampleProjectDir,
      tokenBudget: 2048,
      personalizedFiles: ["utils/validators.ts"],
    });

    const baselineRank = baseline.ranked.findIndex((r) => r.filePath.includes("validators"));
    const boostedRank = boosted.ranked.findIndex((r) => r.filePath.includes("validators"));
    return { baselineRank, boostedRank };
  },
  scorers: [
    createScorer<string, { baselineRank: number; boostedRank: number }>({
      name: "Validators rank improves with boost",
      scorer: ({ output }) => {
        // Boosted rank should be better (lower number) or equal
        return output.boostedRank <= output.baselineRank ? 1 : 0;
      },
    }),
  ],
});
