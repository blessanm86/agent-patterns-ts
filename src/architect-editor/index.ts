import { createCLI } from "../shared/cli.js";
import { getVirtualFS, snapshotVFS, restoreVFS, RECIPE_FILE } from "./tools.js";
import {
  runArchitectEditorPipeline,
  runSingleModelPipeline,
  type PipelineResult,
  type SingleModelResult,
} from "./agent.js";

// ─── Model Configuration ──────────────────────────────────────────────────────
//
// In a real deployment, the architect and editor are different capability tiers.
// Locally we default to two different Ollama model sizes to show the split.
// Swap EDITOR_MODEL to a smaller model (e.g. qwen2.5:3b) to widen the cost gap.

const ARCHITECT_MODEL = process.env.ARCHITECT_MODEL ?? "qwen2.5:14b";
const EDITOR_MODEL = process.env.EDITOR_MODEL ?? "qwen2.5:7b";

// ─── Compare Mode Flag ────────────────────────────────────────────────────────
//
// /compare is a one-shot toggle. The next message after /compare runs BOTH
// pipelines (single-model then dual-model) and shows a side-by-side breakdown.

let compareMode = false;

// ─── Stats Formatting ─────────────────────────────────────────────────────────

function normalStats(result: PipelineResult): string[] {
  const { architect, editor } = result;
  const totalIn = architect.inputTokens + editor.inputTokens;
  const totalOut = architect.outputTokens + editor.outputTokens;
  const w = 28;
  return [
    "",
    "  Token breakdown:",
    `  ${"Stage".padEnd(w)} ${"Model".padEnd(w)} ${"In".padStart(6)} / Out`,
    `  ${"─".repeat(w)} ${"─".repeat(w)} ${"─".repeat(6)}   ${"─".repeat(6)}`,
    `  ${"Architect".padEnd(w)} ${ARCHITECT_MODEL.padEnd(w)} ${String(architect.inputTokens).padStart(6)} / ${architect.outputTokens}`,
    `  ${"Editor".padEnd(w)} ${EDITOR_MODEL.padEnd(w)} ${String(editor.inputTokens).padStart(6)} / ${editor.outputTokens}`,
    `  ${"─".repeat(w)} ${"─".repeat(w)} ${"─".repeat(6)}   ${"─".repeat(6)}`,
    `  ${"Total".padEnd(w)} ${"dual-model".padEnd(w)} ${String(totalIn).padStart(6)} / ${totalOut}`,
    "",
  ];
}

function compareStats(
  single: SingleModelResult,
  dual: PipelineResult,
  singleModel: string,
): string[] {
  const dualIn = dual.architect.inputTokens + dual.editor.inputTokens;
  const dualOut = dual.architect.outputTokens + dual.editor.outputTokens;
  const inSavings =
    single.inputTokens > 0
      ? Math.round(((single.inputTokens - dualIn) / single.inputTokens) * 100)
      : 0;
  const outSavings =
    single.outputTokens > 0
      ? Math.round(((single.outputTokens - dualOut) / single.outputTokens) * 100)
      : 0;

  const w = 22;
  return [
    "",
    "  Pipeline comparison:",
    `  ${"".padEnd(w)} ${"Single-model".padEnd(w)} ${"Dual-model".padEnd(w)}`,
    `  ${"─".repeat(w)} ${"─".repeat(w)} ${"─".repeat(w)}`,
    `  ${"Architect model".padEnd(w)} ${singleModel.padEnd(w)} ${ARCHITECT_MODEL.padEnd(w)}`,
    `  ${"Editor model".padEnd(w)} ${singleModel.padEnd(w)} ${EDITOR_MODEL.padEnd(w)}`,
    `  ${"─".repeat(w)} ${"─".repeat(w)} ${"─".repeat(w)}`,
    `  ${"Input tokens".padEnd(w)} ${String(single.inputTokens).padEnd(w)} ${String(dualIn).padEnd(w)}`,
    `  ${"Output tokens".padEnd(w)} ${String(single.outputTokens).padEnd(w)} ${String(dualOut).padEnd(w)}`,
    `  ${"─".repeat(w)} ${"─".repeat(w)} ${"─".repeat(w)}`,
    `  ${"Input delta".padEnd(w)} ${" ".padEnd(w)} ${inSavings >= 0 ? `${inSavings}% fewer`.padEnd(w) : `${Math.abs(inSavings)}% more`.padEnd(w)}`,
    `  ${"Output delta".padEnd(w)} ${" ".padEnd(w)} ${outSavings >= 0 ? `${outSavings}% fewer`.padEnd(w) : `${Math.abs(outSavings)}% more`.padEnd(w)}`,
    "",
    `  Key: in dual-model, the expensive architect generates fewer output tokens`,
    `       (the plan) while the cheaper editor handles the mechanical edit tokens.`,
    "",
  ];
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

createCLI({
  title: "Architect/Editor Pipeline — Recipe Agent",
  emoji: "🏗️",
  goodbye: "Pipeline shut down.",
  agentLabel: "Pipeline",
  welcomeLines: [
    `  Architect: ${ARCHITECT_MODEL}  →  Editor: ${EDITOR_MODEL}`,
    "",
    "  The architect decides WHAT to change (no tools, no format constraints).",
    "  The editor applies the plan mechanically (tools only, no reasoning).",
    "",
    '  Try: "Add a vegetarian note to the recipe"',
    '  Try: "Change the pasta quantity to 350g and reduce servings to 3"',
    '  Try: "Add a tip about using room-temperature eggs"',
    "",
    "  Commands:",
    "    /recipe  — show the current recipe file",
    "    /compare — run BOTH pipelines on the next message and compare token costs",
    "",
    "  Current recipe (carbonara.md):",
    ...getVirtualFS()
      .get(RECIPE_FILE)!
      .split("\n")
      .map((l) => `    ${l}`),
  ],

  onCommand(command) {
    if (command === "/recipe") {
      const content = getVirtualFS().get(RECIPE_FILE) ?? "";
      console.log(`\n  carbonara.md:\n`);
      for (const line of content.split("\n")) {
        console.log(`    ${line}`);
      }
      return true;
    }

    if (command === "/compare") {
      compareMode = true;
      console.log(
        "\n  Compare mode ON — next message runs single-model AND dual-model pipelines.\n",
      );
      return true;
    }

    return false;
  },

  async onMessage(input, history) {
    if (compareMode) {
      compareMode = false;

      // Snapshot before any run so we can restore between the two pipelines
      const snapshot = snapshotVFS();

      console.log(`\n  Running single-model pipeline (${ARCHITECT_MODEL})...`);
      const single = await runSingleModelPipeline(input, history, ARCHITECT_MODEL);

      // Restore recipe to original state before dual-model run
      restoreVFS(snapshot);

      console.log(`\n  Running dual-model pipeline (${ARCHITECT_MODEL} → ${EDITOR_MODEL})...`);
      const dual = await runArchitectEditorPipeline(input, history, {
        architect: ARCHITECT_MODEL,
        editor: EDITOR_MODEL,
      });

      return {
        messages: dual.messages,
        stats: compareStats(single, dual, ARCHITECT_MODEL),
      };
    }

    const result = await runArchitectEditorPipeline(input, history, {
      architect: ARCHITECT_MODEL,
      editor: EDITOR_MODEL,
    });

    return { messages: result.messages, stats: normalStats(result) };
  },
}).start();
