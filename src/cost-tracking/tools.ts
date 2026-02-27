import type { ToolDefinition, Room, Reservation } from "./types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────
//
// These tell the model WHAT tools exist and how to call them.
// The model decides when and how to use them based on the conversation.

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Check available rooms for a given date range. Returns a list of available rooms with their type and price per night.",
      parameters: {
        type: "object",
        properties: {
          check_in: {
            type: "string",
            description: "Check-in date in YYYY-MM-DD format",
          },
          check_out: {
            type: "string",
            description: "Check-out date in YYYY-MM-DD format",
          },
          room_type: {
            type: "string",
            description: "Optional preferred room type",
            enum: ["single", "double", "suite"],
          },
        },
        required: ["check_in", "check_out"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_room_price",
      description: "Get the total price for a specific room type and number of nights.",
      parameters: {
        type: "object",
        properties: {
          room_type: {
            type: "string",
            description: "The room type",
            enum: ["single", "double", "suite"],
          },
          nights: {
            type: "string",
            description: "Number of nights",
          },
        },
        required: ["room_type", "nights"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_reservation",
      description: "Create a hotel reservation once the guest has confirmed all details.",
      parameters: {
        type: "object",
        properties: {
          guest_name: {
            type: "string",
            description: "Full name of the guest",
          },
          room_type: {
            type: "string",
            description: "The chosen room type",
            enum: ["single", "double", "suite"],
          },
          check_in: {
            type: "string",
            description: "Check-in date in YYYY-MM-DD format",
          },
          check_out: {
            type: "string",
            description: "Check-out date in YYYY-MM-DD format",
          },
        },
        required: ["guest_name", "room_type", "check_in", "check_out"],
      },
    },
  },
];

// ─── Mock Data ────────────────────────────────────────────────────────────────

const ROOM_PRICES: Record<string, number> = {
  single: 120,
  double: 180,
  suite: 350,
};

// Simulates a database of rooms
let MOCK_ROOMS: Room[] = createFreshRooms();

function createFreshRooms(): Room[] {
  return [
    { roomNumber: "101", type: "single", pricePerNight: 120, available: true },
    { roomNumber: "102", type: "single", pricePerNight: 120, available: false },
    { roomNumber: "201", type: "double", pricePerNight: 180, available: true },
    { roomNumber: "202", type: "double", pricePerNight: 180, available: true },
    { roomNumber: "301", type: "suite", pricePerNight: 350, available: true },
  ];
}

/** Reset mock data to initial state (used by /reset command). */
export function resetMockData(): void {
  MOCK_ROOMS = createFreshRooms();
}

// ─── Tool Implementations ─────────────────────────────────────────────────────
//
// These are the actual functions that run when the model calls a tool.
// In a real app these would hit a database or external API.

function checkAvailability(args: {
  check_in: string;
  check_out: string;
  room_type?: string;
}): string {
  const checkIn = new Date(args.check_in);
  const checkOut = new Date(args.check_out);
  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

  if (nights <= 0) {
    return JSON.stringify({ error: "Check-out must be after check-in" });
  }

  let available = MOCK_ROOMS.filter((r) => r.available);
  if (args.room_type) {
    available = available.filter((r) => r.type === args.room_type);
  }

  if (available.length === 0) {
    return JSON.stringify({
      available: false,
      message: "No rooms available for those dates",
    });
  }

  return JSON.stringify({
    available: true,
    nights,
    rooms: available.map((r) => ({
      type: r.type,
      pricePerNight: r.pricePerNight,
      totalPrice: r.pricePerNight * nights,
    })),
  });
}

function getRoomPrice(args: { room_type: string; nights: string }): string {
  const price = ROOM_PRICES[args.room_type];
  if (!price) {
    return JSON.stringify({ error: `Unknown room type: ${args.room_type}` });
  }

  const nights = parseInt(args.nights, 10);
  const total = price * nights;

  return JSON.stringify({
    room_type: args.room_type,
    pricePerNight: price,
    nights,
    totalPrice: total,
    currency: "USD",
  });
}

function createReservation(args: {
  guest_name: string;
  room_type: string;
  check_in: string;
  check_out: string;
}): string {
  const checkIn = new Date(args.check_in);
  const checkOut = new Date(args.check_out);
  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  const pricePerNight = ROOM_PRICES[args.room_type] ?? 0;
  const totalPrice = pricePerNight * nights;

  // Find a matching available room
  const room = MOCK_ROOMS.find((r) => r.type === args.room_type && r.available);
  if (!room) {
    return JSON.stringify({ success: false, error: "No rooms of that type are available" });
  }

  // Mark it as booked (in a real app this would be a DB write)
  room.available = false;

  const reservation: Reservation = {
    reservationId: `RES-${Date.now()}`,
    guestName: args.guest_name,
    roomNumber: room.roomNumber,
    roomType: args.room_type,
    checkIn: args.check_in,
    checkOut: args.check_out,
    totalPrice,
    nights,
  };

  return JSON.stringify({ success: true, reservation });
}

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────
//
// Routes a tool call from the model to the correct implementation.

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "check_availability":
      return checkAvailability(args as Parameters<typeof checkAvailability>[0]);
    case "get_room_price":
      return getRoomPrice(args as Parameters<typeof getRoomPrice>[0]);
    case "create_reservation":
      return createReservation(args as Parameters<typeof createReservation>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
