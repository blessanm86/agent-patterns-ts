import type { ToolDefinition } from "../shared/types.js";
import { TodoState, type TodoItem } from "./todo-state.js";

// ─── Agent Mode ──────────────────────────────────────────────────────────────

export type AgentMode = "with-todos" | "no-todos";

// ─── Mock Data ───────────────────────────────────────────────────────────────
//
// ShipIt CI/CD platform — three sample projects with different stacks.
// Each project has enough detail to drive 5+ TODO items during pipeline setup.

interface ProjectConfig {
  name: string;
  framework: string;
  buildCommand: string;
  testCommand: string;
  hasDocker: boolean;
  envVars: string[];
  outputDir: string;
}

const PROJECTS: Record<string, ProjectConfig> = {
  "webapp-frontend": {
    name: "webapp-frontend",
    framework: "Next.js 15",
    buildCommand: "pnpm build",
    testCommand: "pnpm test",
    hasDocker: true,
    envVars: ["NEXT_PUBLIC_API_URL", "DATABASE_URL", "AUTH_SECRET"],
    outputDir: ".next",
  },
  "api-service": {
    name: "api-service",
    framework: "Fastify + TypeScript",
    buildCommand: "pnpm build",
    testCommand: "pnpm test:ci",
    hasDocker: true,
    envVars: ["DATABASE_URL", "REDIS_URL", "JWT_SECRET", "STRIPE_KEY"],
    outputDir: "dist",
  },
  "data-pipeline": {
    name: "data-pipeline",
    framework: "Python + dbt",
    buildCommand: "pip install -r requirements.txt && dbt compile",
    testCommand: "pytest && dbt test",
    hasDocker: false,
    envVars: ["WAREHOUSE_URL", "DBT_PROFILES_DIR", "SLACK_WEBHOOK"],
    outputDir: "target",
  },
};

interface PipelineTemplate {
  id: string;
  name: string;
  stages: string[];
  description: string;
}

const TEMPLATES: PipelineTemplate[] = [
  {
    id: "node-standard",
    name: "Node.js Standard",
    stages: ["install", "lint", "test", "build", "deploy-staging", "deploy-production"],
    description:
      "Full pipeline with lint, test, build, and two-stage deployment. Recommended for production apps.",
  },
  {
    id: "node-simple",
    name: "Node.js Simple",
    stages: ["install", "test", "build", "deploy-staging"],
    description: "Minimal pipeline for internal tools and prototypes. No lint stage, staging only.",
  },
];

// Mutable state: configured stages accumulate as the agent works
const configuredStages = new Map<string, { stage: string; config: Record<string, string> }>();

// ─── Tool Definitions ────────────────────────────────────────────────────────

const todoWriteTool: ToolDefinition = {
  type: "function",
  function: {
    name: "todo_write",
    description: `Create or update your TODO list to track progress on the current task.

RULES:
- Call this BEFORE starting work to outline your plan
- Update the status of each item BEFORE and AFTER working on it
- Send the COMPLETE list every time (full replacement, not incremental)
- Each item needs: id, content, status ("pending" | "in_progress" | "completed"), and optional activeForm (present-tense label like "Configuring lint stage")

Example JSON:
[{"id":"1","content":"Inspect project configuration","status":"completed"},{"id":"2","content":"Configure install stage","status":"in_progress","activeForm":"Configuring install stage"},{"id":"3","content":"Configure lint stage","status":"pending"}]`,
    parameters: {
      type: "object",
      properties: {
        todos_json: {
          type: "string",
          description: "JSON string of the complete TODO list array",
        },
      },
      required: ["todos_json"],
    },
  },
};

const inspectProjectTool: ToolDefinition = {
  type: "function",
  function: {
    name: "inspect_project",
    description:
      "Inspect a project's configuration to determine its framework, build commands, test setup, Docker support, and required environment variables. Call this first to understand what pipeline stages are needed.",
    parameters: {
      type: "object",
      properties: {
        project_name: {
          type: "string",
          description:
            'The project to inspect (e.g., "webapp-frontend", "api-service", "data-pipeline")',
        },
      },
      required: ["project_name"],
    },
  },
};

const listPipelineTemplatesTool: ToolDefinition = {
  type: "function",
  function: {
    name: "list_pipeline_templates",
    description:
      "List available pipeline templates with their included stages. Use this to pick the right template for the project.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const configureStageTool: ToolDefinition = {
  type: "function",
  function: {
    name: "configure_stage",
    description: `Configure a specific pipeline stage. Call once per stage with the stage name and its configuration.

Available stages: install, lint, test, build, deploy-staging, deploy-production.
Each stage needs a "command" at minimum. Deploy stages also need "environment" and "env_vars" (comma-separated list of required env var names).`,
    parameters: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          description:
            'The stage to configure: "install", "lint", "test", "build", "deploy-staging", or "deploy-production"',
        },
        command: {
          type: "string",
          description: 'The command to run for this stage (e.g., "pnpm install", "pnpm test")',
        },
        environment: {
          type: "string",
          description:
            'Target environment for deploy stages (e.g., "staging", "production"). Required for deploy stages.',
        },
        env_vars: {
          type: "string",
          description:
            'Comma-separated environment variable names required for this stage (e.g., "DATABASE_URL,AUTH_SECRET")',
        },
      },
      required: ["stage", "command"],
    },
  },
};

const validatePipelineTool: ToolDefinition = {
  type: "function",
  function: {
    name: "validate_pipeline",
    description:
      "Validate the configured pipeline. Checks that all required stages exist, deploy stages have environments set, and required env vars are configured. Call this after configuring all stages.",
    parameters: {
      type: "object",
      properties: {
        template_id: {
          type: "string",
          description: 'The template to validate against (e.g., "node-standard", "node-simple")',
        },
      },
      required: ["template_id"],
    },
  },
};

// ─── Tool Implementations ────────────────────────────────────────────────────

function inspectProject(args: { project_name: string }): string {
  const project = PROJECTS[args.project_name];
  if (!project) {
    return JSON.stringify({
      error: `Unknown project "${args.project_name}". Available: ${Object.keys(PROJECTS).join(", ")}`,
    });
  }
  return JSON.stringify({
    project: project.name,
    framework: project.framework,
    buildCommand: project.buildCommand,
    testCommand: project.testCommand,
    hasDocker: project.hasDocker,
    requiredEnvVars: project.envVars,
    outputDir: project.outputDir,
    recommendation:
      project.envVars.length > 3
        ? "Complex setup — use node-standard template with all stages"
        : "Standard setup — node-standard template recommended",
  });
}

function listPipelineTemplates(): string {
  return JSON.stringify({
    templates: TEMPLATES,
    note: "Pick a template that matches your project needs. You can configure each stage individually after selecting.",
  });
}

function configureStage(args: {
  stage: string;
  command: string;
  environment?: string;
  env_vars?: string;
}): string {
  const validStages = ["install", "lint", "test", "build", "deploy-staging", "deploy-production"];
  if (!validStages.includes(args.stage)) {
    return JSON.stringify({
      error: `Invalid stage "${args.stage}". Valid stages: ${validStages.join(", ")}`,
    });
  }

  const config: Record<string, string> = { command: args.command };
  if (args.environment) config.environment = args.environment;
  if (args.env_vars) config.env_vars = args.env_vars;

  configuredStages.set(args.stage, { stage: args.stage, config });

  return JSON.stringify({
    configured: args.stage,
    config,
    totalConfigured: configuredStages.size,
    message: `Stage "${args.stage}" configured successfully.`,
  });
}

function validatePipeline(args: { template_id: string }): string {
  const template = TEMPLATES.find((t) => t.id === args.template_id);
  if (!template) {
    return JSON.stringify({
      error: `Unknown template "${args.template_id}". Available: ${TEMPLATES.map((t) => t.id).join(", ")}`,
    });
  }

  const errors: string[] = [];

  // Check all required stages are configured
  for (const stage of template.stages) {
    if (!configuredStages.has(stage)) {
      errors.push(`Missing required stage: "${stage}"`);
    }
  }

  // Check deploy stages have environment set
  for (const [name, entry] of configuredStages) {
    if (name.startsWith("deploy-") && !entry.config.environment) {
      errors.push(`Deploy stage "${name}" missing required "environment" configuration`);
    }
  }

  if (errors.length > 0) {
    return JSON.stringify({
      valid: false,
      errors,
      configuredStages: configuredStages.size,
      requiredStages: template.stages.length,
    });
  }

  // Build final pipeline summary
  const pipeline = template.stages.map((stage) => {
    const entry = configuredStages.get(stage)!;
    return { stage, ...entry.config };
  });

  return JSON.stringify({
    valid: true,
    pipeline,
    template: template.name,
    totalStages: pipeline.length,
    message: "Pipeline validation passed. All stages configured correctly.",
  });
}

function todoWrite(args: { todos_json: string }, todoState: TodoState): string {
  try {
    const items: TodoItem[] = JSON.parse(args.todos_json);
    todoState.update(items);
  } catch {
    // Malformed JSON — silently ignore (state-only tool)
  }
  // Returns empty string: state-only tool, exists for UI communication
  return "";
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(
  name: string,
  args: Record<string, string>,
  todoState?: TodoState,
): string {
  switch (name) {
    case "todo_write":
      return todoWrite(args as { todos_json: string }, todoState!);
    case "inspect_project":
      return inspectProject(args as { project_name: string });
    case "list_pipeline_templates":
      return listPipelineTemplates();
    case "configure_stage":
      return configureStage(
        args as { stage: string; command: string; environment?: string; env_vars?: string },
      );
    case "validate_pipeline":
      return validatePipeline(args as { template_id: string });
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Build Tools For Mode ────────────────────────────────────────────────────

export function buildTools(mode: AgentMode): ToolDefinition[] {
  const domainTools = [
    inspectProjectTool,
    listPipelineTemplatesTool,
    configureStageTool,
    validatePipelineTool,
  ];

  if (mode === "with-todos") {
    return [todoWriteTool, ...domainTools];
  }
  return domainTools;
}

// ─── Reset (for fresh conversations) ─────────────────────────────────────────

export function resetPipelineState(): void {
  configuredStages.clear();
}
