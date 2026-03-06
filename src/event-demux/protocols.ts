// ─── Foreign Protocol Definitions ───────────────────────────────────────────
//
// These represent the two most common LLM streaming protocols in the wild:
// 1. Anthropic's SSE schema (content_block_start/delta/stop with index routing)
// 2. OpenAI's Responses API schema (output_index/content_index routing)
//
// In a real system, these would come from actual API calls. Here we define
// the type schemas so our simulated sub-agents can emit realistic events.

// ─── Anthropic-Like Protocol ────────────────────────────────────────────────
//
// Claude's streaming uses content blocks identified by index. Each block is
// either text or tool_use, and deltas carry the index to route correctly.

export interface AnthropicMessageStart {
  type: "message_start";
  message: { id: string; role: "assistant" };
}

export interface AnthropicContentBlockStart {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "text"; text: "" }
    | { type: "tool_use"; id: string; name: string; input: Record<string, never> };
}

export interface AnthropicContentBlockDelta {
  type: "content_block_delta";
  index: number;
  delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string };
}

export interface AnthropicContentBlockStop {
  type: "content_block_stop";
  index: number;
}

export interface AnthropicMessageDelta {
  type: "message_delta";
  delta: { stop_reason: "end_turn" | "tool_use" };
}

export interface AnthropicMessageStop {
  type: "message_stop";
}

export interface AnthropicPing {
  type: "ping";
}

export type AnthropicEvent =
  | AnthropicMessageStart
  | AnthropicContentBlockStart
  | AnthropicContentBlockDelta
  | AnthropicContentBlockStop
  | AnthropicMessageDelta
  | AnthropicMessageStop
  | AnthropicPing;

// ─── OpenAI-Like Protocol ───────────────────────────────────────────────────
//
// OpenAI's Responses API uses output_index and content_index to route deltas
// to the correct buffer. Events follow a response > output_item > content_part
// hierarchy. sequence_number provides ordering guarantees.

export interface OpenAIResponseCreated {
  type: "response.created";
  response: { id: string; status: "in_progress" };
}

export interface OpenAIOutputItemAdded {
  type: "response.output_item.added";
  output_index: number;
  item: { id: string; type: "message" | "function_call"; name?: string };
}

export interface OpenAIContentPartAdded {
  type: "response.content_part.added";
  output_index: number;
  content_index: number;
  part: { type: "output_text"; text: "" } | { type: "function_call_output" };
}

export interface OpenAIOutputTextDelta {
  type: "response.output_text.delta";
  output_index: number;
  content_index: number;
  delta: string;
  sequence_number: number;
}

export interface OpenAIFunctionCallArgsDelta {
  type: "response.function_call_arguments.delta";
  output_index: number;
  delta: string;
  sequence_number: number;
}

export interface OpenAIFunctionCallArgsDone {
  type: "response.function_call_arguments.done";
  output_index: number;
  arguments: string;
}

export interface OpenAIOutputTextDone {
  type: "response.output_text.done";
  output_index: number;
  content_index: number;
  text: string;
}

export interface OpenAIOutputItemDone {
  type: "response.output_item.done";
  output_index: number;
  item: { id: string; type: "message" | "function_call" };
}

export interface OpenAIResponseCompleted {
  type: "response.completed";
  response: {
    id: string;
    status: "completed";
    usage: { input_tokens: number; output_tokens: number };
  };
}

export type OpenAIEvent =
  | OpenAIResponseCreated
  | OpenAIOutputItemAdded
  | OpenAIContentPartAdded
  | OpenAIOutputTextDelta
  | OpenAIFunctionCallArgsDelta
  | OpenAIFunctionCallArgsDone
  | OpenAIOutputTextDone
  | OpenAIOutputItemDone
  | OpenAIResponseCompleted;
