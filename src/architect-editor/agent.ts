import ollama from "ollama";
import { tools, executeTool, getVirtualFS, clearReadSet, RECIPE_FILE } from "./tools.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";

// ─── System Prompts ───────────────────────────────────────────────────────────
//
// The two prompts are the core of the pattern. Notice what each one omits:
//
// ARCHITECT: no mention of file editing, tools, old_str, or formats.
//            It reasons freely about what to change.
//
// EDITOR:    no mention of problem-solving or understanding the request.
//            It applies a pre-decided plan mechanically.
//
// This separation is what allows each model to focus on its strength.

const ARCHITECT_SYSTEM = `You are an expert recipe developer.

The user will ask you to modify a recipe. Your job is to describe, in plain English, exactly what changes need to be made.

Be specific. Instead of "update the pasta quantity", write "change '400g spaghetti' to '350g spaghetti' in the Ingredients section". Instead of "add a dietary note", write "add the line '- Nut-free.' at the end of the Notes section".

Do NOT produce file edits, code blocks, or formatted patches. Describe WHAT to change, not HOW to format the edit. Your output will be read by a separate file-editing model that handles the mechanics.`;

const EDITOR_SYSTEM = `You are a file editing assistant.

The changes to apply to the recipe file have already been worked out. Your job is to apply them precisely.

EDITING WORKFLOW:
1. Call read_file("${RECIPE_FILE}") to see the current content.
2. For each change, call edit_file with:
   - old_str: the exact text to replace (include the full line plus 1-2 neighboring lines)
   - new_str: the replacement text
3. If "No match found" → re-read the file and adjust old_str to match exactly.
4. If "Found multiple matches" → add more neighboring lines to old_str.

After all changes are applied, briefly confirm what was done (one line per change).`;

// Single-model baseline: the model handles both reasoning and formatting.
// Used in compare mode to show the cost of combining both tasks in one prompt.
const SINGLE_MODEL_SYSTEM = `You are a recipe developer and file editing assistant.

For each recipe modification request:
1. Think carefully about what needs to change and which text to find.
2. Call read_file("${RECIPE_FILE}") to see the current content.
3. Apply each change using edit_file:
   - old_str must match the file exactly (same whitespace and punctuation)
   - Include 1-2 neighboring lines so old_str uniquely identifies the location
4. Confirm what was changed.

If edit_file returns an error:
- "No match found" → re-read the file and try a different old_str
- "Found multiple matches" → add more surrounding lines to old_str`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArchitectResult {
  plan: string;
  inputTokens: number;
  outputTokens: number;
}

export interface EditorResult {
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

export interface PipelineResult {
  messages: Message[];
  architect: ArchitectResult;
  editor: EditorResult;
}

export interface SingleModelResult {
  messages: Message[];
  inputTokens: number;
  outputTokens: number;
}

// ─── Stage 1: Architect ───────────────────────────────────────────────────────
//
// A single LLM call — no tools, no format constraints.
// The model receives the current recipe content and the user's request,
// then describes what to change in plain English.

export async function runArchitect(
  userMessage: string,
  architectModel: string,
): Promise<ArchitectResult> {
  const fileContent = getVirtualFS().get(RECIPE_FILE) ?? "";

  // Inject the current file so the architect can reference specific text
  const augmentedMessage = `Here is the current recipe:\n\n\`\`\`\n${fileContent}\`\`\`\n\nRequest: ${userMessage}`;

  const response = await ollama.chat({
    model: architectModel,
    // @ts-expect-error — system not in ChatRequest types but works at runtime
    system: ARCHITECT_SYSTEM,
    messages: [{ role: "user", content: augmentedMessage }],
  });

  return {
    plan: response.message.content,
    inputTokens: response.prompt_eval_count ?? 0,
    outputTokens: response.eval_count ?? 0,
  };
}

// ─── Stage 2: Editor ──────────────────────────────────────────────────────────
//
// A ReAct loop — tools only, no reasoning burden.
// The model receives the architect's plan and applies it using read_file /
// edit_file. Its system prompt contains only file editing mechanics.

export async function runEditor(plan: string, editorModel: string): Promise<EditorResult> {
  // Reset read tracking so the editor must explicitly read_file to get current content
  clearReadSet();

  const messages: Message[] = [
    { role: "user", content: `Apply the following changes to ${RECIPE_FILE}:\n\n${plan}` },
  ];

  let totalInput = 0;
  let totalOutput = 0;

  while (true) {
    const response = await ollama.chat({
      model: editorModel,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: EDITOR_SYSTEM,
      messages,
      tools,
    });

    totalInput += response.prompt_eval_count ?? 0;
    totalOutput += response.eval_count ?? 0;

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls?.length) break;

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 200 });
      messages.push({ role: "tool", content: result });
    }
  }

  const summary =
    [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "Changes applied.";

  return { summary, inputTokens: totalInput, outputTokens: totalOutput };
}

// ─── Dual-Model Pipeline ──────────────────────────────────────────────────────
//
// Runs architect → editor in sequence. The main conversation history receives
// a single combined assistant message (plan + confirmation), keeping the thread
// clean for multi-turn use.

export async function runArchitectEditorPipeline(
  userMessage: string,
  history: Message[],
  models: { architect: string; editor: string },
): Promise<PipelineResult> {
  const architect = await runArchitect(userMessage, models.architect);
  const editor = await runEditor(architect.plan, models.editor);

  const combinedContent =
    `**Architect's plan (${models.architect}):**\n${architect.plan}\n\n` +
    `**Editor applied (${models.editor}):**\n${editor.summary}`;

  const messages: Message[] = [
    ...history,
    { role: "user", content: userMessage },
    { role: "assistant", content: combinedContent },
  ];

  return { messages, architect, editor };
}

// ─── Single-Model Baseline ────────────────────────────────────────────────────
//
// The same task handled by one model — no pre-decided plan. Used in compare
// mode to show the token difference between combined and split approaches.

export async function runSingleModelPipeline(
  userMessage: string,
  history: Message[],
  model: string,
): Promise<SingleModelResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  let totalInput = 0;
  let totalOutput = 0;

  while (true) {
    const response = await ollama.chat({
      model,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SINGLE_MODEL_SYSTEM,
      messages,
      tools,
    });

    totalInput += response.prompt_eval_count ?? 0;
    totalOutput += response.eval_count ?? 0;

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls?.length) break;

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 200 });
      messages.push({ role: "tool", content: result });
    }
  }

  return { messages, inputTokens: totalInput, outputTokens: totalOutput };
}
