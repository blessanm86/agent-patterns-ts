import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────
//
// 4 restaurant tools spanning the risk spectrum:
//   read-only : search_restaurants, get_menu
//   low       : make_reservation
//   high      : cancel_reservation  ← triggers approval flow

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description:
        "Search for restaurants by cuisine type, price range, or date availability. Returns matching restaurants with ratings and available time slots.",
      parameters: {
        type: "object",
        properties: {
          cuisine: {
            type: "string",
            description: "Type of cuisine to search for",
            enum: ["italian", "japanese", "mexican", "french", "indian"],
          },
          price_range: {
            type: "string",
            description: "Price range filter",
            enum: ["$", "$$", "$$$", "$$$$"],
          },
          date: {
            type: "string",
            description: "Date to check availability (YYYY-MM-DD)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_menu",
      description:
        "Get the full menu for a specific restaurant, including dishes, prices, and dietary info.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: {
            type: "string",
            description: "The restaurant ID (e.g. rest-1)",
          },
        },
        required: ["restaurant_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_reservation",
      description: "Book a table at a restaurant for a specific date, time, and party size.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: {
            type: "string",
            description: "The restaurant ID",
          },
          date: {
            type: "string",
            description: "Reservation date (YYYY-MM-DD)",
          },
          time: {
            type: "string",
            description: "Reservation time (HH:MM)",
          },
          party_size: {
            type: "string",
            description: "Number of guests",
          },
          name: {
            type: "string",
            description: "Name for the reservation",
          },
        },
        required: ["restaurant_id", "date", "time", "party_size", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_reservation",
      description:
        "Cancel an existing reservation. This action cannot be undone — the time slot will be released and may be taken by someone else.",
      parameters: {
        type: "object",
        properties: {
          reservation_id: {
            type: "string",
            description: "The reservation ID to cancel (e.g. rsv-1001)",
          },
        },
        required: ["reservation_id"],
      },
    },
  },
];

// ─── Risk Map ────────────────────────────────────────────────────────────────

export type RiskLevel = "read-only" | "low" | "high";

export const TOOL_RISK_MAP: Record<string, RiskLevel> = {
  search_restaurants: "read-only",
  get_menu: "read-only",
  make_reservation: "low",
  cancel_reservation: "high",
};

// ─── Mock Data ───────────────────────────────────────────────────────────────

interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  priceRange: string;
  rating: number;
  address: string;
  availableSlots: string[];
}

interface MenuItem {
  name: string;
  price: number;
  dietary: string[];
}

interface Reservation {
  id: string;
  restaurantId: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  name: string;
}

const RESTAURANTS: Restaurant[] = [
  {
    id: "rest-1",
    name: "Trattoria Bella",
    cuisine: "italian",
    priceRange: "$$",
    rating: 4.5,
    address: "42 Olive Garden Lane",
    availableSlots: ["18:00", "18:30", "19:00", "20:00", "20:30", "21:00"],
  },
  {
    id: "rest-2",
    name: "Sakura House",
    cuisine: "japanese",
    priceRange: "$$$",
    rating: 4.8,
    address: "7 Cherry Blossom Ave",
    availableSlots: ["17:30", "18:00", "19:30", "20:00", "21:30"],
  },
  {
    id: "rest-3",
    name: "Casa de Sol",
    cuisine: "mexican",
    priceRange: "$",
    rating: 4.2,
    address: "15 Sunset Blvd",
    availableSlots: ["17:00", "18:00", "19:00", "19:30", "20:00", "21:00"],
  },
  {
    id: "rest-4",
    name: "Le Petit Bistro",
    cuisine: "french",
    priceRange: "$$$$",
    rating: 4.9,
    address: "1 Champs-Elysees Ct",
    availableSlots: ["19:00", "19:30", "20:30", "21:00"],
  },
  {
    id: "rest-5",
    name: "Spice Garden",
    cuisine: "indian",
    priceRange: "$$",
    rating: 4.6,
    address: "88 Curry Road",
    availableSlots: ["17:30", "18:00", "18:30", "19:00", "20:00", "20:30", "21:00"],
  },
];

const MENUS: Record<string, MenuItem[]> = {
  "rest-1": [
    { name: "Margherita Pizza", price: 14, dietary: ["vegetarian"] },
    { name: "Spaghetti Carbonara", price: 16, dietary: [] },
    { name: "Risotto ai Funghi", price: 18, dietary: ["vegetarian", "gluten-free"] },
    { name: "Osso Buco", price: 28, dietary: ["gluten-free"] },
    { name: "Tiramisu", price: 10, dietary: ["vegetarian"] },
  ],
  "rest-2": [
    { name: "Omakase (8 pieces)", price: 45, dietary: ["gluten-free"] },
    { name: "Ramen Tonkotsu", price: 18, dietary: [] },
    { name: "Tempura Platter", price: 22, dietary: [] },
    { name: "Vegetable Bento", price: 20, dietary: ["vegetarian"] },
    { name: "Matcha Mochi", price: 8, dietary: ["vegetarian", "gluten-free"] },
  ],
  "rest-3": [
    { name: "Street Tacos (3)", price: 10, dietary: ["gluten-free"] },
    { name: "Burrito Grande", price: 13, dietary: [] },
    { name: "Enchiladas Verdes", price: 14, dietary: ["gluten-free"] },
    { name: "Guacamole & Chips", price: 9, dietary: ["vegan", "gluten-free"] },
    { name: "Churros", price: 7, dietary: ["vegetarian"] },
  ],
  "rest-4": [
    { name: "Foie Gras Torchon", price: 32, dietary: ["gluten-free"] },
    { name: "Coq au Vin", price: 38, dietary: ["gluten-free"] },
    { name: "Bouillabaisse", price: 42, dietary: ["gluten-free"] },
    { name: "Ratatouille", price: 26, dietary: ["vegan", "gluten-free"] },
    { name: "Creme Brulee", price: 14, dietary: ["vegetarian", "gluten-free"] },
  ],
  "rest-5": [
    { name: "Butter Chicken", price: 16, dietary: ["gluten-free"] },
    { name: "Palak Paneer", price: 14, dietary: ["vegetarian", "gluten-free"] },
    { name: "Lamb Biryani", price: 18, dietary: [] },
    { name: "Samosa Platter", price: 10, dietary: ["vegetarian"] },
    { name: "Gulab Jamun", price: 8, dietary: ["vegetarian"] },
  ],
};

let nextReservationId = 1001;
const RESERVATIONS: Reservation[] = [
  {
    id: "rsv-1000",
    restaurantId: "rest-2",
    restaurantName: "Sakura House",
    date: "2026-03-05",
    time: "19:30",
    partySize: 2,
    name: "Alex Johnson",
  },
];

// ─── Tool Implementations ────────────────────────────────────────────────────

function searchRestaurants(args: {
  cuisine?: string;
  price_range?: string;
  date?: string;
}): string {
  let results = RESTAURANTS;

  if (args.cuisine) {
    results = results.filter((r) => r.cuisine === args.cuisine);
  }
  if (args.price_range) {
    results = results.filter((r) => r.priceRange === args.price_range);
  }

  if (results.length === 0) {
    return JSON.stringify({ restaurants: [], message: "No restaurants match your criteria" });
  }

  return JSON.stringify({
    restaurants: results.map((r) => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      priceRange: r.priceRange,
      rating: r.rating,
      address: r.address,
      availableSlots: r.availableSlots,
    })),
    total: results.length,
  });
}

function getMenu(args: { restaurant_id: string }): string {
  const restaurant = RESTAURANTS.find((r) => r.id === args.restaurant_id);
  if (!restaurant) {
    return JSON.stringify({ error: `Restaurant ${args.restaurant_id} not found` });
  }

  const menu = MENUS[args.restaurant_id] ?? [];
  return JSON.stringify({
    restaurant: restaurant.name,
    items: menu,
  });
}

function makeReservation(args: {
  restaurant_id: string;
  date: string;
  time: string;
  party_size: string;
  name: string;
}): string {
  const restaurant = RESTAURANTS.find((r) => r.id === args.restaurant_id);
  if (!restaurant) {
    return JSON.stringify({ error: `Restaurant ${args.restaurant_id} not found` });
  }

  if (!restaurant.availableSlots.includes(args.time)) {
    return JSON.stringify({
      error: `Time slot ${args.time} is not available at ${restaurant.name}. Available: ${restaurant.availableSlots.join(", ")}`,
    });
  }

  const id = `rsv-${nextReservationId++}`;
  const reservation: Reservation = {
    id,
    restaurantId: args.restaurant_id,
    restaurantName: restaurant.name,
    date: args.date,
    time: args.time,
    partySize: Number.parseInt(args.party_size, 10) || 2,
    name: args.name,
  };
  RESERVATIONS.push(reservation);

  // Remove the slot from available
  const slotIdx = restaurant.availableSlots.indexOf(args.time);
  if (slotIdx !== -1) restaurant.availableSlots.splice(slotIdx, 1);

  return JSON.stringify({ success: true, reservation });
}

function cancelReservation(args: { reservation_id: string }): string {
  const index = RESERVATIONS.findIndex((r) => r.id === args.reservation_id);
  if (index === -1) {
    return JSON.stringify({ error: `Reservation ${args.reservation_id} not found` });
  }

  const cancelled = RESERVATIONS.splice(index, 1)[0];

  // Restore the time slot
  const restaurant = RESTAURANTS.find((r) => r.id === cancelled.restaurantId);
  if (restaurant) {
    restaurant.availableSlots.push(cancelled.time);
    restaurant.availableSlots.sort();
  }

  return JSON.stringify({
    success: true,
    cancelled: {
      id: cancelled.id,
      restaurant: cancelled.restaurantName,
      date: cancelled.date,
      time: cancelled.time,
      name: cancelled.name,
    },
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_restaurants":
      return searchRestaurants(args as Parameters<typeof searchRestaurants>[0]);
    case "get_menu":
      return getMenu(args as Parameters<typeof getMenu>[0]);
    case "make_reservation":
      return makeReservation(args as Parameters<typeof makeReservation>[0]);
    case "cancel_reservation":
      return cancelReservation(args as Parameters<typeof cancelReservation>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Action Description ──────────────────────────────────────────────────────

export function describeAction(toolName: string, args: Record<string, string>): string {
  switch (toolName) {
    case "search_restaurants":
      return args.cuisine ? `Search ${args.cuisine} restaurants` : "Search all restaurants";
    case "get_menu":
      return `View menu for ${args.restaurant_id}`;
    case "make_reservation":
      return `Book table for ${args.party_size} at ${args.restaurant_id} on ${args.date} at ${args.time}`;
    case "cancel_reservation":
      return `Cancel reservation ${args.reservation_id}`;
    default:
      return `${toolName}(${JSON.stringify(args)})`;
  }
}
