import type { ToolDefinition } from "../shared/types.js";

// ─── Skill Type ──────────────────────────────────────────────────────────────
//
// A skill is a named bundle of step-by-step instructions for a multi-tool
// workflow. Instead of embedding all this in tool descriptions (which bloats
// the context window), the agent loads skills on demand via a `get_skill`
// meta-tool. Only skills whose required tools are all present get offered.

export interface Skill {
  name: string;
  description: string; // One-line — shown in the skill catalog
  requiredTools: string[]; // Must all be present for the skill to be offered
  instructions: string[]; // Full step-by-step — loaded on demand
}

// ─── Skill Registry ──────────────────────────────────────────────────────────

const SKILL_REGISTRY: Skill[] = [
  {
    name: "investigate_complaint",
    description:
      "Investigate a customer complaint about an order (damaged item, wrong item, missing item)",
    requiredTools: ["search_orders", "get_order_details", "check_inventory"],
    instructions: [
      "Use search_orders to find the order by ID or customer name",
      "Use get_order_details to pull the full order record — note the items, status, and shipping info",
      "For each item the customer complained about, use check_inventory to see if a replacement is in stock",
      "Summarize your findings: order status, what went wrong, and whether replacements are available",
    ],
  },
  {
    name: "process_return",
    description: "Process a return and refund for an order",
    requiredTools: ["get_order_details", "process_refund", "check_inventory"],
    instructions: [
      "Use get_order_details to verify the order exists and check its current status",
      "Confirm the order is eligible for return (must be in 'shipped' or 'delivered' status)",
      "Use process_refund to issue the refund — pass the order ID and reason",
      "Use check_inventory to see if the returned item can be restocked or if a replacement should be sent",
      "Report the outcome: refund amount, whether a replacement is available, and next steps",
    ],
  },
  {
    name: "fulfill_backorder",
    description: "Check pending orders and fulfill any that now have inventory available",
    requiredTools: ["search_orders", "check_inventory", "update_shipping", "send_customer_email"],
    instructions: [
      "Use search_orders with status 'processing' to find all pending/backorder orders",
      "For each pending order, use check_inventory to check if the items are now in stock",
      "For orders that can be fulfilled, use update_shipping to set shipping status to 'shipped' with a tracking number",
      "Use send_customer_email to notify each customer whose order has been shipped",
      "Summarize: how many orders were checked, how many fulfilled, how many still waiting",
    ],
  },
  {
    name: "full_escalation_workflow",
    description:
      "End-to-end complaint handling: investigate, attempt resolution, process return if needed, notify customer",
    requiredTools: [
      "search_orders",
      "get_order_details",
      "check_inventory",
      "process_refund",
      "update_shipping",
      "send_customer_email",
    ],
    instructions: [
      "First, follow the 'investigate_complaint' skill steps: search the order, get details, check inventory",
      "Based on findings, decide on resolution: replacement (if in stock) or refund",
      "If replacing: use update_shipping to ship the replacement and send_customer_email with the new tracking info",
      "If refunding: follow the 'process_return' skill steps to issue the refund",
      "Use send_customer_email to send a final summary to the customer with what was done and any next steps",
    ],
  },
];

// ─── Skill Functions ─────────────────────────────────────────────────────────

/** Filter the registry to only skills whose required tools are all present */
export function getAvailableSkills(presentToolNames: string[]): Skill[] {
  const present = new Set(presentToolNames);
  return SKILL_REGISTRY.filter((skill) => skill.requiredTools.every((t) => present.has(t)));
}

/** Return the full instructions for a skill by name (called by get_skill tool) */
export function getSkillInstructions(name: string): string {
  const skill = SKILL_REGISTRY.find((s) => s.name === name);
  if (!skill) {
    return JSON.stringify({
      error: `Unknown skill: "${name}". Use get_skill with a valid skill name from the catalog.`,
    });
  }
  return JSON.stringify({
    skill: skill.name,
    description: skill.description,
    requiredTools: skill.requiredTools,
    instructions: skill.instructions.map((step, i) => `${i + 1}. ${step}`),
  });
}

/** Build the get_skill tool definition with a dynamic enum of available skills */
export function buildGetSkillTool(presentToolNames: string[]): ToolDefinition {
  const available = getAvailableSkills(presentToolNames);
  return {
    type: "function",
    function: {
      name: "get_skill",
      description:
        "Load step-by-step instructions for a multi-tool workflow. Call this BEFORE starting a complex procedure to get the recommended sequence of tool calls. Returns numbered instructions and the list of tools you'll need.",
      parameters: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            description: "The name of the skill to load",
            enum: available.map((s) => s.name),
          },
        },
        required: ["skill_name"],
      },
    },
  };
}

/** Build the skill catalog section for the system prompt */
export function buildSkillCatalog(presentToolNames: string[]): string {
  const available = getAvailableSkills(presentToolNames);
  if (available.length === 0) return "";

  const lines = [
    "## Available Skills",
    "",
    "Before starting a multi-step workflow, call get_skill to load the step-by-step instructions.",
    "Available skills:",
    "",
  ];

  for (const skill of available) {
    lines.push(`- **${skill.name}**: ${skill.description}`);
  }

  return lines.join("\n");
}
