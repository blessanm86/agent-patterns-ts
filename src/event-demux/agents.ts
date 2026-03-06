// ─── Simulated Sub-Agents ───────────────────────────────────────────────────
//
// Two sub-agents that emit events in different streaming protocols.
// In a real system, these would be actual API calls to different LLM providers.
// Here we simulate realistic event sequences with timing to demonstrate
// the demultiplexing challenge.
//
// The flight agent uses Anthropic-like events (content_block_start/delta/stop).
// The hotel agent uses OpenAI-like events (response.output_text.delta).

import type { AnthropicEvent } from "./protocols.js";
import type { OpenAIEvent } from "./protocols.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++idCounter}`;
}

// ─── Flight Agent (Anthropic-like protocol) ─────────────────────────────────
//
// Emits a text block with flight info, then a tool_use block for booking.
// Events arrive with realistic inter-token delays.

export async function* runFlightAgent(query: string): AsyncGenerator<AnthropicEvent> {
  const msgId = nextId("msg");

  // Message envelope
  yield { type: "message_start", message: { id: msgId, role: "assistant" } };

  // Block 0: text response about flights
  yield {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" as const },
  };

  const flightText = getFlightResponse(query);
  // Stream token-by-token (Anthropic sends small chunks)
  for (const word of flightText.split(" ")) {
    await sleep(15 + Math.random() * 25);
    yield {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: `${word} ` },
    };
  }

  yield { type: "content_block_stop", index: 0 };

  // Ping keepalive (Anthropic-specific, should be filtered by adapter)
  yield { type: "ping" };

  // Block 1: tool_use for search_flights
  const toolId = nextId("toolu");
  yield {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: toolId, name: "search_flights", input: {} },
  };

  // Stream JSON arguments in chunks
  const argsJson = JSON.stringify({ origin: "SEA", destination: "PDX", date: "2025-03-15" });
  const argChunks = splitIntoChunks(argsJson, 12);
  for (const chunk of argChunks) {
    await sleep(10 + Math.random() * 15);
    yield {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: chunk },
    };
  }

  yield { type: "content_block_stop", index: 1 };

  // Message completion
  yield { type: "message_delta", delta: { stop_reason: "tool_use" } };
  yield { type: "message_stop" };
}

// ─── Hotel Agent (OpenAI-like protocol) ─────────────────────────────────────
//
// Emits a text message about hotels, then a function_call for booking.
// Events carry output_index/content_index/sequence_number for routing.

export async function* runHotelAgent(query: string): AsyncGenerator<OpenAIEvent> {
  const respId = nextId("resp");

  yield { type: "response.created", response: { id: respId, status: "in_progress" } };

  // Output 0: text message
  const msgItemId = nextId("item");
  yield {
    type: "response.output_item.added",
    output_index: 0,
    item: { id: msgItemId, type: "message" },
  };
  yield {
    type: "response.content_part.added",
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "" as const },
  };

  const hotelText = getHotelResponse(query);
  let seq = 0;
  // Stream text in slightly larger chunks (OpenAI tends to send more per event)
  const textChunks = splitIntoChunks(hotelText, 25);
  for (const chunk of textChunks) {
    await sleep(20 + Math.random() * 30);
    yield {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: chunk,
      sequence_number: ++seq,
    };
  }

  yield { type: "response.output_text.done", output_index: 0, content_index: 0, text: hotelText };
  yield {
    type: "response.output_item.done",
    output_index: 0,
    item: { id: msgItemId, type: "message" },
  };

  // Output 1: function call for search_hotels
  const fnItemId = nextId("item");
  yield {
    type: "response.output_item.added",
    output_index: 1,
    item: { id: fnItemId, type: "function_call", name: "search_hotels" },
  };

  const fnArgs = JSON.stringify({
    city: "Portland",
    checkin: "2025-03-15",
    checkout: "2025-03-17",
  });
  const fnChunks = splitIntoChunks(fnArgs, 15);
  for (const chunk of fnChunks) {
    await sleep(10 + Math.random() * 20);
    yield {
      type: "response.function_call_arguments.delta",
      output_index: 1,
      delta: chunk,
      sequence_number: ++seq,
    };
  }

  yield { type: "response.function_call_arguments.done", output_index: 1, arguments: fnArgs };
  yield {
    type: "response.output_item.done",
    output_index: 1,
    item: { id: fnItemId, type: "function_call" },
  };

  yield {
    type: "response.completed",
    response: { id: respId, status: "completed", usage: { input_tokens: 150, output_tokens: 89 } },
  };
}

// ─── Response Content ───────────────────────────────────────────────────────

function getFlightResponse(_query: string): string {
  return (
    "I found several flights from Seattle to Portland on March 15. " +
    "Alaska Airlines has a direct flight departing at 8:30 AM arriving at 9:45 AM for $89. " +
    "Delta has a noon departure arriving at 1:15 PM for $112. " +
    "Let me search for the best options with current availability."
  );
}

function getHotelResponse(_query: string): string {
  return (
    "Here are the top hotel options in Portland for March 15-17. " +
    "The Ace Hotel in downtown has rooms from $165/night with great reviews. " +
    "Hotel Lucia offers boutique rooms starting at $189/night near Pioneer Square. " +
    "I'll check real-time availability and pricing for you."
  );
}

// ─── String Chunking ────────────────────────────────────────────────────────

function splitIntoChunks(str: string, maxLen: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += maxLen) {
    chunks.push(str.slice(i, i + maxLen));
  }
  return chunks;
}
