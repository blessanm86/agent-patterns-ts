import type { ToolDefinition } from "../shared/types.js";
import {
  executeFlightTool,
  executeHotelTool,
  executeActivityTool,
} from "../multi-agent-routing/tools.js";

// ─── Delegation Tool Definitions ────────────────────────────────────────────
//
// These are the PARENT agent's tools. Instead of searching flights directly,
// the parent delegates to specialist child agents. Each delegation tool
// maps to a child agent profile from multi-agent-routing.
//
// The parent never calls search_flights or find_attractions directly.
// It calls delegate_flight_research, which spawns a child agent that does.

export const delegationTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "delegate_flight_research",
      description:
        "Delegate flight research to a specialist flight agent. Provide a natural language task describing what flights to search for, including origin, destination, and dates. The flight agent will search and compare options, returning a summary of the best findings.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "Natural language task for the flight agent, e.g. 'Find flights from Seattle to Portland for March 15, 2025'",
          },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_hotel_research",
      description:
        "Delegate hotel research to a specialist hotel agent. Provide a natural language task describing what hotels to search for, including city, check-in, and check-out dates. The hotel agent will search and provide details, returning a summary of the best options.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "Natural language task for the hotel agent, e.g. 'Find hotels in Portland for March 15-17, 2025'",
          },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_activity_research",
      description:
        "Delegate activity and dining research to a specialist activity agent. Provide a natural language task describing what attractions or restaurants to find, including the city. The activity agent will find options and return a curated summary.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "Natural language task for the activity agent, e.g. 'Find top attractions and restaurants in Portland'",
          },
        },
        required: ["task"],
      },
    },
  },
];

// ─── Portland Mock Data ─────────────────────────────────────────────────────
//
// Extends the travel domain with Portland-specific data.
// This lives here (not in multi-agent-routing) to avoid modifying concept 7.
// The child agents use dispatchers from multi-agent-routing, which fall through
// to generic data if the city isn't found. Portland data patches that gap.

// Portland flights are injected by wrapping the existing flight dispatcher.
const PORTLAND_FLIGHTS: Record<
  string,
  Array<{ airline: string; price: number; duration: string; departure: string }>
> = {
  "seattle-portland": [
    { airline: "Alaska Airlines", price: 120, duration: "1h 05m", departure: "07:30" },
    { airline: "Delta", price: 145, duration: "1h 10m", departure: "12:15" },
    { airline: "United", price: 135, duration: "1h 08m", departure: "17:45" },
  ],
  "san francisco-portland": [
    { airline: "Alaska Airlines", price: 180, duration: "2h 00m", departure: "08:00" },
    { airline: "Southwest", price: 155, duration: "2h 10m", departure: "13:30" },
    { airline: "United", price: 195, duration: "1h 55m", departure: "18:00" },
  ],
  "los angeles-portland": [
    { airline: "Alaska Airlines", price: 210, duration: "2h 35m", departure: "06:45" },
    { airline: "Delta", price: 240, duration: "2h 40m", departure: "11:00" },
    { airline: "Southwest", price: 190, duration: "2h 50m", departure: "16:20" },
  ],
};

const PORTLAND_HOTELS: Array<{
  name: string;
  stars: number;
  pricePerNight: number;
  neighborhood: string;
}> = [
  { name: "Hotel deLuxe", stars: 4, pricePerNight: 220, neighborhood: "Downtown" },
  {
    name: "McMenamins Kennedy School",
    stars: 3,
    pricePerNight: 155,
    neighborhood: "Northeast Portland",
  },
  { name: "The Nines", stars: 5, pricePerNight: 350, neighborhood: "Downtown" },
];

const PORTLAND_HOTEL_DETAILS: Record<
  string,
  {
    amenities: string[];
    roomTypes: Array<{ type: string; pricePerNight: number }>;
    cancellation: string;
  }
> = {
  "hotel deluxe": {
    amenities: ["Free WiFi", "Restaurant", "Fitness Center", "Concierge", "Pet Friendly"],
    roomTypes: [
      { type: "Classic King", pricePerNight: 220 },
      { type: "Deluxe Suite", pricePerNight: 340 },
    ],
    cancellation: "Free cancellation up to 48 hours before check-in",
  },
  "mcmenamins kennedy school": {
    amenities: ["Soaking Pool", "Movie Theater", "Multiple Bars", "Restaurant", "Free WiFi"],
    roomTypes: [
      { type: "Standard Room", pricePerNight: 155 },
      { type: "Detention Room", pricePerNight: 175 },
    ],
    cancellation: "Free cancellation up to 24 hours before check-in",
  },
  "the nines": {
    amenities: ["Rooftop Bar", "Spa", "Fitness Center", "Restaurant", "Concierge", "Pet Friendly"],
    roomTypes: [
      { type: "Deluxe King", pricePerNight: 350 },
      { type: "Cloud Nine Suite", pricePerNight: 550 },
    ],
    cancellation: "Free cancellation up to 72 hours before check-in",
  },
};

const PORTLAND_ATTRACTIONS: Array<{
  name: string;
  description: string;
  visitTime: string;
}> = [
  {
    name: "Powell's City of Books",
    description: "World's largest independent bookstore, spanning an entire city block",
    visitTime: "2-3 hours",
  },
  {
    name: "International Rose Test Garden",
    description: "Free garden with 10,000+ rose bushes and views of Mt. Hood",
    visitTime: "1-2 hours",
  },
  {
    name: "Portland Japanese Garden",
    description:
      "Serene 12-acre garden considered the most authentic Japanese garden outside Japan",
    visitTime: "2 hours",
  },
  {
    name: "Forest Park",
    description:
      "5,200-acre urban forest with 80+ miles of trails, one of the largest city parks in the US",
    visitTime: "2-4 hours",
  },
  {
    name: "Portland Saturday Market",
    description: "Largest continuously operating outdoor arts and crafts market in the US",
    visitTime: "2-3 hours",
  },
];

const PORTLAND_RESTAURANTS: Array<{
  name: string;
  cuisine: string;
  priceRange: string;
  mustTry: string;
}> = [
  {
    name: "Pok Pok",
    cuisine: "Thai Street Food",
    priceRange: "$$",
    mustTry: "Vietnamese fish-sauce wings",
  },
  {
    name: "Screen Door",
    cuisine: "Southern Comfort",
    priceRange: "$$",
    mustTry: "Praline bacon and hush puppies",
  },
  {
    name: "Salt & Straw",
    cuisine: "Ice Cream",
    priceRange: "$",
    mustTry: "Sea salt with caramel ribbons",
  },
];

// ─── Portland-Aware Dispatchers ─────────────────────────────────────────────
//
// These wrap the existing multi-agent-routing dispatchers, checking Portland
// data first and falling through to the original dispatchers if no match.

function normalizeCity(city: string): string {
  return city.toLowerCase().trim();
}

function portlandFlightDispatch(name: string, args: Record<string, string>): string | null {
  if (name === "search_flights") {
    const origin = normalizeCity(args.origin ?? "");
    const destination = normalizeCity(args.destination ?? "");
    const key = `${origin}-${destination}`;
    const reverseKey = `${destination}-${origin}`;
    const flights = PORTLAND_FLIGHTS[key] ?? PORTLAND_FLIGHTS[reverseKey];
    if (flights) {
      return JSON.stringify({
        route: `${args.origin} → ${args.destination}`,
        date: args.date,
        options: flights,
      });
    }
  }
  if (name === "compare_flight_prices") {
    const origin = normalizeCity(args.origin ?? "");
    const destination = normalizeCity(args.destination ?? "");
    const key = `${origin}-${destination}`;
    const reverseKey = `${destination}-${origin}`;
    const flights = PORTLAND_FLIGHTS[key] ?? PORTLAND_FLIGHTS[reverseKey];
    if (flights) {
      const sorted = [...flights].sort((a, b) => a.price - b.price);
      const cheapest = sorted[0].price;
      return JSON.stringify({
        route: `${args.origin} → ${args.destination}`,
        comparison: sorted.map((f) => ({
          ...f,
          savings:
            f.price - cheapest > 0
              ? `$${f.price - cheapest} more than cheapest`
              : "Cheapest option",
        })),
        cheapest: sorted[0].airline,
        mostExpensive: sorted[sorted.length - 1].airline,
        maxSavings: `$${sorted[sorted.length - 1].price - cheapest}`,
      });
    }
  }
  return null;
}

function portlandHotelDispatch(name: string, args: Record<string, string>): string | null {
  if (name === "search_hotels") {
    const city = normalizeCity(args.city ?? "");
    if (city === "portland") {
      const checkIn = new Date(args.check_in);
      const checkOut = new Date(args.check_out);
      const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
      return JSON.stringify({
        city: args.city,
        check_in: args.check_in,
        check_out: args.check_out,
        nights,
        options: PORTLAND_HOTELS.map((h) => ({ ...h, totalPrice: h.pricePerNight * nights })),
      });
    }
  }
  if (name === "get_hotel_details") {
    const key = (args.hotel_name ?? "").toLowerCase().trim();
    const details = PORTLAND_HOTEL_DETAILS[key];
    if (details) {
      return JSON.stringify({ hotel: args.hotel_name, ...details });
    }
  }
  return null;
}

function portlandActivityDispatch(name: string, args: Record<string, string>): string | null {
  if (name === "find_attractions") {
    const city = normalizeCity(args.city ?? "");
    if (city === "portland") {
      return JSON.stringify({ city: args.city, attractions: PORTLAND_ATTRACTIONS });
    }
  }
  if (name === "find_restaurants") {
    const city = normalizeCity(args.city ?? "");
    if (city === "portland") {
      let restaurants = PORTLAND_RESTAURANTS;
      if (args.cuisine) {
        const filtered = restaurants.filter((r) =>
          r.cuisine.toLowerCase().includes(args.cuisine.toLowerCase()),
        );
        if (filtered.length > 0) restaurants = filtered;
      }
      return JSON.stringify({ city: args.city, cuisine_filter: args.cuisine ?? null, restaurants });
    }
  }
  return null;
}

// ─── Exported Dispatchers ───────────────────────────────────────────────────
//
// Portland-first, then fall through to multi-agent-routing originals.

export function executeFlightToolWithPortland(name: string, args: Record<string, string>): string {
  return portlandFlightDispatch(name, args) ?? executeFlightTool(name, args);
}

export function executeHotelToolWithPortland(name: string, args: Record<string, string>): string {
  return portlandHotelDispatch(name, args) ?? executeHotelTool(name, args);
}

export function executeActivityToolWithPortland(
  name: string,
  args: Record<string, string>,
): string {
  return portlandActivityDispatch(name, args) ?? executeActivityTool(name, args);
}
