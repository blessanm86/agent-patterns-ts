// ─── On-Demand Skill Injection Evals ──────────────────────────────────────────
//
// 4 groups:
//   1. Skill filtering (deterministic) — getAvailableSkills with full/partial tool sets
//   2. Skill instructions (deterministic) — getSkillInstructions returns correct data
//   3. Agent uses get_skill (LLM-dependent) — agent calls get_skill for multi-step workflows
//   4. Comparison (LLM-dependent) — skills mode has smaller totalPromptChars

import { evalite, createScorer } from "evalite";
import { getAvailableSkills, getSkillInstructions } from "../skills.js";
import { runAgent, type AgentStats } from "../agent.js";
import { extractToolCallNames } from "../../react/eval-utils.js";

// ─── Group 1: Skill Filtering (deterministic) ───────────────────────────────

evalite("Skill filtering — all tools present", {
  data: async () => [
    {
      input: [
        "search_orders",
        "get_order_details",
        "process_refund",
        "update_shipping",
        "send_customer_email",
        "check_inventory",
      ],
    },
  ],
  task: async (input) => getAvailableSkills(input),
  scorers: [
    createScorer<string[], ReturnType<typeof getAvailableSkills>>({
      name: "all 4 skills available",
      scorer: ({ output }) => (output.length === 4 ? 1 : 0),
    }),
    createScorer<string[], ReturnType<typeof getAvailableSkills>>({
      name: "full_escalation_workflow included",
      scorer: ({ output }) => (output.some((s) => s.name === "full_escalation_workflow") ? 1 : 0),
    }),
  ],
});

evalite("Skill filtering — partial tools (no send_customer_email)", {
  data: async () => [
    {
      input: ["search_orders", "get_order_details", "process_refund", "check_inventory"],
    },
  ],
  task: async (input) => getAvailableSkills(input),
  scorers: [
    createScorer<string[], ReturnType<typeof getAvailableSkills>>({
      name: "investigate_complaint available",
      scorer: ({ output }) => (output.some((s) => s.name === "investigate_complaint") ? 1 : 0),
    }),
    createScorer<string[], ReturnType<typeof getAvailableSkills>>({
      name: "process_return available",
      scorer: ({ output }) => (output.some((s) => s.name === "process_return") ? 1 : 0),
    }),
    createScorer<string[], ReturnType<typeof getAvailableSkills>>({
      name: "fulfill_backorder excluded (missing send_customer_email)",
      scorer: ({ output }) => (output.some((s) => s.name === "fulfill_backorder") ? 0 : 1),
    }),
    createScorer<string[], ReturnType<typeof getAvailableSkills>>({
      name: "full_escalation excluded (missing tools)",
      scorer: ({ output }) => (output.some((s) => s.name === "full_escalation_workflow") ? 0 : 1),
    }),
  ],
});

evalite("Skill filtering — minimal tools", {
  data: async () => [{ input: ["search_orders"] }],
  task: async (input) => getAvailableSkills(input),
  scorers: [
    createScorer<string[], ReturnType<typeof getAvailableSkills>>({
      name: "no skills available",
      scorer: ({ output }) => (output.length === 0 ? 1 : 0),
    }),
  ],
});

// ─── Group 2: Skill Instructions (deterministic) ────────────────────────────

evalite("Skill instructions — valid skill returns steps", {
  data: async () => [{ input: "investigate_complaint" }, { input: "process_return" }],
  task: async (input) => JSON.parse(getSkillInstructions(input)),
  scorers: [
    createScorer<string, Record<string, unknown>>({
      name: "has instructions array",
      scorer: ({ output }) =>
        Array.isArray(output.instructions) && output.instructions.length > 0 ? 1 : 0,
    }),
    createScorer<string, Record<string, unknown>>({
      name: "has requiredTools",
      scorer: ({ output }) =>
        Array.isArray(output.requiredTools) && output.requiredTools.length > 0 ? 1 : 0,
    }),
    createScorer<string, Record<string, unknown>>({
      name: "has skill name",
      scorer: ({ output }) => (typeof output.skill === "string" ? 1 : 0),
    }),
  ],
});

evalite("Skill instructions — unknown skill returns error", {
  data: async () => [{ input: "nonexistent_skill" }],
  task: async (input) => JSON.parse(getSkillInstructions(input)),
  scorers: [
    createScorer<string, Record<string, unknown>>({
      name: "returns error",
      scorer: ({ output }) => (typeof output.error === "string" ? 1 : 0),
    }),
  ],
});

// ─── Group 3: Agent Uses get_skill (LLM-dependent) ──────────────────────────

evalite("Agent — calls get_skill for complaint investigation", {
  data: async () => [
    { input: "A customer says their order ORD-1001 arrived damaged, can you help?" },
  ],
  task: async (input) => {
    const result = await runAgent(input, [], "skills");
    const toolNames = extractToolCallNames(result.messages);
    return { toolNames, stats: result.stats };
  },
  scorers: [
    createScorer<string, { toolNames: string[]; stats: AgentStats }>({
      name: "called get_skill",
      scorer: ({ output }) => (output.toolNames.includes("get_skill") ? 1 : 0),
    }),
    createScorer<string, { toolNames: string[]; stats: AgentStats }>({
      name: "called domain tools after get_skill",
      scorer: ({ output }) => {
        const names = output.toolNames;
        const skillIdx = names.indexOf("get_skill");
        // At least one domain tool was called after get_skill
        return skillIdx !== -1 && names.slice(skillIdx + 1).some((n) => n !== "get_skill") ? 1 : 0;
      },
    }),
  ],
});

// ─── Group 4: Comparison (LLM-dependent) ─────────────────────────────────────

type ComparisonResult = { skills: AgentStats; noSkills: AgentStats };

evalite("Comparison — skills mode has smaller prompt", {
  data: async () => [
    { input: "A customer says their order ORD-1001 arrived damaged, can you help?" },
  ],
  task: async (input) => {
    const skills = await runAgent(input, [], "skills");
    const noSkills = await runAgent(input, [], "no-skills");
    return { skills: skills.stats, noSkills: noSkills.stats };
  },
  scorers: [
    createScorer<string, ComparisonResult>({
      name: "skills mode has smaller totalPromptChars",
      scorer: ({ output }) =>
        output.skills.totalPromptChars < output.noSkills.totalPromptChars ? 1 : 0,
    }),
  ],
});
