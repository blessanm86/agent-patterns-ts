// ─── Parent Orchestrator ────────────────────────────────────────────────────
//
// Demonstrates the two modes:
// 1. Raw mode: consumes foreign events directly, no normalization.
//    Output is garbled — events from two protocols interleave without
//    attribution, text accumulates incorrectly, tool calls are mangled.
//
// 2. Demux mode: foreign events pass through protocol-specific adapters
//    into a canonical schema, then through the EventDemultiplexer for
//    per-agent accumulation. Output is clean and correctly attributed.

import { runFlightAgent, runHotelAgent } from "./agents.js";
import {
  AnthropicAdapter,
  OpenAIAdapter,
  EventDemultiplexer,
  type CanonicalEvent,
} from "./canonical.js";
import type { AnthropicEvent } from "./protocols.js";
import type { OpenAIEvent } from "./protocols.js";

// ─── Color Helpers ──────────────────────────────────────────────────────────

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ─── Raw Mode (No Demultiplexing) ───────────────────────────────────────────
//
// Shows what happens when you consume heterogeneous event streams directly.
// The two protocols have incompatible schemas — text appears garbled,
// there's no way to attribute output to the correct agent, and tool call
// arguments from different agents can merge into nonsense.

export async function runRawMode(query: string): Promise<void> {
  console.log(`\n${BOLD}${RED}  ── Raw Mode (No Demultiplexing) ──${RESET}\n`);
  console.log(`${DIM}  Events from two protocols arrive interleaved on one stream.`);
  console.log(`  No normalization, no attribution. Watch the chaos.${RESET}\n`);

  // Collect all events with their raw types, interleaved
  const allEvents: Array<{ source: string; event: AnthropicEvent | OpenAIEvent }> = [];
  let flightDone = false;
  let hotelDone = false;

  const flightGen = runFlightAgent(query);
  const hotelGen = runHotelAgent(query);

  // Interleave events from both generators (simulates concurrent streams)
  while (!flightDone || !hotelDone) {
    if (!flightDone) {
      const result = await flightGen.next();
      if (result.done) {
        flightDone = true;
      } else {
        allEvents.push({ source: "flight", event: result.value });
      }
    }
    if (!hotelDone) {
      const result = await hotelGen.next();
      if (result.done) {
        hotelDone = true;
      } else {
        allEvents.push({ source: "hotel", event: result.value });
      }
    }
  }

  // Display raw events — the consumer sees untyped heterogeneous events
  let rawTextBuffer = "";
  let rawToolBuffer = "";
  let eventCount = 0;

  for (const { event } of allEvents) {
    eventCount++;

    // Naive text extraction: just grab any text-like field
    if ("delta" in event && typeof event.delta === "object" && event.delta !== null) {
      const delta = event.delta as Record<string, unknown>;
      if ("text" in delta && typeof delta.text === "string") {
        rawTextBuffer += delta.text;
      } else if ("partial_json" in delta && typeof delta.partial_json === "string") {
        rawToolBuffer += delta.partial_json;
      }
    }
    if ("delta" in event && typeof event.delta === "string") {
      // OpenAI text deltas use a flat string
      rawTextBuffer += event.delta;
    }
  }

  console.log(`  ${DIM}Total events received: ${eventCount}${RESET}\n`);

  console.log(`  ${BOLD}Accumulated text (all agents merged):${RESET}`);
  console.log(`  ${rawTextBuffer.slice(0, 200)}...`);
  console.log();

  console.log(`  ${BOLD}Accumulated tool args (all agents merged):${RESET}`);
  console.log(`  ${rawToolBuffer}`);
  console.log();

  console.log(`  ${RED}Problems:${RESET}`);
  console.log(`  ${RED}  1. Text from flight + hotel agents is merged into one blob${RESET}`);
  console.log(`  ${RED}  2. No way to tell which text came from which agent${RESET}`);
  console.log(`  ${RED}  3. Tool call arguments from both agents are concatenated${RESET}`);
  console.log(`  ${RED}  4. Anthropic "ping" events mixed with OpenAI "response.created"${RESET}`);
  console.log(`  ${RED}  5. No lifecycle tracking — can't tell when each agent finished${RESET}`);
}

// ─── Demux Mode (With Event Demultiplexing) ─────────────────────────────────
//
// Foreign events pass through protocol-specific adapters into canonical events,
// each tagged with sourceAgentId. The EventDemultiplexer routes them to
// per-agent accumulators. Output is clean and correctly attributed.

export async function runDemuxMode(query: string): Promise<void> {
  console.log(`\n${BOLD}${GREEN}  ── Demux Mode (With Event Demultiplexing) ──${RESET}\n`);
  console.log(`${DIM}  Foreign events → Protocol Adapters → Canonical Events → Demultiplexer`);
  console.log(`  Every event tagged with sourceAgentId. Clean attribution.${RESET}\n`);

  // Set up adapters for each sub-agent's protocol
  const flightAdapter = new AnthropicAdapter("flight-agent", "Flight Specialist");
  const hotelAdapter = new OpenAIAdapter("hotel-agent", "Hotel Specialist");
  const demuxer = new EventDemultiplexer();

  // Canonical event log for display
  const canonicalLog: CanonicalEvent[] = [];

  // Process events from both agents concurrently
  const flightGen = runFlightAgent(query);
  const hotelGen = runHotelAgent(query);
  let flightDone = false;
  let hotelDone = false;

  while (!flightDone || !hotelDone) {
    if (!flightDone) {
      const result = await flightGen.next();
      if (result.done) {
        flightDone = true;
      } else {
        const canonical = flightAdapter.transform(result.value);
        for (const evt of canonical) {
          canonicalLog.push(evt);
          demuxer.process(evt);
          printCanonicalEvent(evt);
        }
      }
    }
    if (!hotelDone) {
      const result = await hotelGen.next();
      if (result.done) {
        hotelDone = true;
      } else {
        const canonical = hotelAdapter.transform(result.value);
        for (const evt of canonical) {
          canonicalLog.push(evt);
          demuxer.process(evt);
          printCanonicalEvent(evt);
        }
      }
    }
  }

  // Show accumulated results
  console.log(`\n${BOLD}  ── Accumulated Results (Per-Agent) ──${RESET}\n`);

  for (const agent of demuxer.getAllAgents()) {
    const color = agent.agentId === "flight-agent" ? CYAN : YELLOW;
    console.log(`  ${color}${BOLD}${agent.agentName}${RESET} ${DIM}(${agent.agentId})${RESET}`);
    console.log(`  ${DIM}Status: ${agent.ended ? "complete" : "in progress"}${RESET}`);

    for (const block of agent.blocks) {
      if (block.type === "text") {
        console.log(`  ${color}[text]${RESET} ${block.content.slice(0, 120)}...`);
      } else {
        console.log(`  ${color}[tool: ${block.toolName}]${RESET} ${block.content}`);
      }
    }
    console.log();
  }

  // Summary stats
  const textEvents = canonicalLog.filter((e) => e.type === "text_delta").length;
  const toolEvents = canonicalLog.filter((e) => e.type === "tool_delta").length;
  const totalEvents = canonicalLog.length;

  console.log(
    `  ${DIM}Canonical events: ${totalEvents} total (${textEvents} text deltas, ${toolEvents} tool deltas)${RESET}`,
  );
  console.log(`  ${DIM}Agents tracked: ${demuxer.getAllAgents().length}${RESET}`);
  console.log(`  ${DIM}All complete: ${demuxer.allComplete()}${RESET}`);
}

// ─── Event Printer ──────────────────────────────────────────────────────────

function printCanonicalEvent(event: CanonicalEvent): void {
  const isFlightAgent = event.sourceAgentId === "flight-agent";
  const color = isFlightAgent ? CYAN : YELLOW;
  const label = isFlightAgent ? "flight" : " hotel";

  switch (event.type) {
    case "agent_start":
      console.log(
        `  ${color}[${label}]${RESET} ${BOLD}agent_start${RESET} ${DIM}${event.agentName}${RESET}`,
      );
      break;
    case "text_start":
      console.log(`  ${color}[${label}]${RESET} text_start ${DIM}${event.blockId}${RESET}`);
      break;
    case "text_delta":
      process.stdout.write(`${color}.${RESET}`);
      break;
    case "text_end":
      console.log(
        `\n  ${color}[${label}]${RESET} text_end ${DIM}(${event.fullText.length} chars)${RESET}`,
      );
      break;
    case "tool_start":
      console.log(
        `  ${color}[${label}]${RESET} ${GREEN}tool_start${RESET} ${event.toolName} ${DIM}${event.blockId}${RESET}`,
      );
      break;
    case "tool_delta":
      process.stdout.write(`${GREEN}+${RESET}`);
      break;
    case "tool_end":
      console.log(
        `\n  ${color}[${label}]${RESET} ${GREEN}tool_end${RESET} ${event.toolName} ${DIM}args=${event.arguments}${RESET}`,
      );
      break;
    case "agent_end":
      console.log(
        `  ${color}[${label}]${RESET} ${BOLD}agent_end${RESET} ${DIM}${event.agentName}${RESET}`,
      );
      break;
    case "error":
      console.log(`  ${RED}[${label}] ERROR: ${event.message}${RESET}`);
      break;
  }
}
