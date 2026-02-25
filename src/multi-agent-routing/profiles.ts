import type { ToolDefinition } from "../shared/types.js";
import {
  flightTools,
  hotelTools,
  activityTools,
  allTools,
  executeFlightTool,
  executeHotelTool,
  executeActivityTool,
  executeAnyTool,
} from "./tools.js";

// ─── Agent Profile Interface ─────────────────────────────────────────────────
//
// An AgentProfile is everything needed to run a scoped ReAct loop:
// - A system prompt focused on one domain
// - A narrow tool set (only the tools this agent needs)
// - A scoped dispatcher (only executes this agent's tools)
//
// The key insight: the ReAct loop itself doesn't change.
// Only what you inject into it changes.

export interface AgentProfile {
  name: string; // machine-readable identifier (used by router)
  label: string; // human-readable display name
  description: string; // for the router prompt — what this agent handles
  systemPrompt: string; // domain-specific instructions
  tools: ToolDefinition[]; // scoped tool set
  executeTool: (name: string, args: Record<string, string>) => string;
}

// ─── Specialist Profiles ─────────────────────────────────────────────────────

const flightAgent: AgentProfile = {
  name: "flight_agent",
  label: "Flight Agent",
  description:
    "Handles flight searches, price comparisons, airline recommendations, routes, and travel dates. Use for anything related to flying between cities.",
  systemPrompt: `You are a flight specialist travel agent. You help users find the best flights for their trips.

Your expertise:
- Searching for available flights between cities
- Comparing prices across airlines to find the best deals
- Recommending departure times based on user preferences
- Explaining route options (direct vs connecting)

Always use your tools to look up real flight data before giving recommendations.
When comparing options, highlight price differences, duration tradeoffs, and departure convenience.
If the user asks about something outside your domain (hotels, restaurants, attractions), let them know you specialize in flights.`,
  tools: flightTools,
  executeTool: executeFlightTool,
};

const hotelAgent: AgentProfile = {
  name: "hotel_agent",
  label: "Hotel Agent",
  description:
    "Handles hotel searches, room details, amenities, neighborhoods, accommodation options, and booking information. Use for anything related to where to stay.",
  systemPrompt: `You are a hotel specialist travel agent. You help users find the perfect accommodation.

Your expertise:
- Searching for hotels by city and dates
- Providing detailed hotel information (amenities, room types, cancellation policies)
- Recommending neighborhoods for different types of travelers
- Comparing star ratings and value for money

Always use your tools to look up real hotel data before giving recommendations.
When presenting options, highlight the neighborhood, star rating, and price per night.
Use get_hotel_details to provide in-depth information when users ask about a specific property.
If the user asks about something outside your domain (flights, restaurants, attractions), let them know you specialize in hotels.`,
  tools: hotelTools,
  executeTool: executeHotelTool,
};

const activityAgent: AgentProfile = {
  name: "activity_agent",
  label: "Activity Agent",
  description:
    "Handles attractions, restaurants, things to do, sightseeing, dining, cuisine, nightlife, and local experiences. Use for anything related to activities at the destination.",
  systemPrompt: `You are an activities and dining specialist travel agent. You help users discover what to do and where to eat.

Your expertise:
- Finding top attractions and sightseeing spots
- Recommending restaurants by cuisine type
- Suggesting itineraries based on available time
- Highlighting must-try local experiences and dishes

Always use your tools to look up real attraction and restaurant data before giving recommendations.
When suggesting attractions, mention estimated visit times to help with planning.
When recommending restaurants, highlight the must-try dishes and price range.
If the user asks about something outside your domain (flights, hotels), let them know you specialize in activities and dining.`,
  tools: activityTools,
  executeTool: executeActivityTool,
};

// ─── General Agent (Fallback) ────────────────────────────────────────────────
//
// Used when router confidence is low or when the query spans multiple domains.
// Has access to all 6 tools — trades specialization for breadth.

export const generalAgent: AgentProfile = {
  name: "general_agent",
  label: "General Agent",
  description: "Handles any travel query. Fallback when the question spans multiple domains.",
  systemPrompt: `You are a full-service travel assistant. You can help with flights, hotels, restaurants, and attractions.

You have access to all travel tools:
- Flight search and price comparison
- Hotel search and detailed property information
- Attraction and restaurant recommendations

Help the user plan their trip by using the right tools for each question.
When a question involves multiple aspects (e.g., "plan a trip to Paris"), use multiple tools to build a comprehensive answer.`,
  tools: allTools,
  executeTool: executeAnyTool,
};

// ─── Exports ─────────────────────────────────────────────────────────────────

export const SPECIALIST_PROFILES: AgentProfile[] = [flightAgent, hotelAgent, activityAgent];

export function getProfileByName(name: string): AgentProfile {
  const profile = SPECIALIST_PROFILES.find((p) => p.name === name);
  return profile ?? generalAgent;
}
