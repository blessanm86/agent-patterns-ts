import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Check available rooms for a given date range. Returns a list of available rooms with their type and price per night. Dates must be in YYYY-MM-DD format.",
      parameters: {
        type: "object",
        properties: {
          check_in: {
            type: "string",
            description: "Check-in date in YYYY-MM-DD format (e.g. 2026-03-15)",
          },
          check_out: {
            type: "string",
            description: "Check-out date in YYYY-MM-DD format (e.g. 2026-03-18)",
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
            description: "Number of nights as a positive integer",
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

// ─── Structured Error Types ───────────────────────────────────────────────────
//
// Every error has a machine-readable code the agent.ts classifier can match on.
// This is the key difference from the base hotel tools — rich structured errors
// enable meaningful corrective prompts.

export type ErrorCode =
  | "invalid_date_format" // e.g. "next friday" or "March 1" passed as check_in
  | "checkout_before_checkin" // check_out <= check_in
  | "unknown_room_type" // value not in the enum
  | "no_rooms_available" // no matching available rooms
  | "reservation_conflict" // room was just booked by someone else (fatal)
  | "missing_required_field"; // a required arg was absent/empty

interface ToolError {
  error: ErrorCode;
  message: string;
}

function toolError(code: ErrorCode, message: string): string {
  return JSON.stringify({ error: code, message } satisfies ToolError);
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const ROOM_PRICES: Record<string, number> = {
  single: 120,
  double: 180,
  suite: 350,
};

const VALID_ROOM_TYPES = new Set(["single", "double", "suite"]);

interface Room {
  roomNumber: string;
  type: "single" | "double" | "suite";
  pricePerNight: number;
  available: boolean;
}

// Mutable in-place — same pattern as src/react/tools.ts
export const MOCK_ROOMS: Room[] = [
  { roomNumber: "101", type: "single", pricePerNight: 120, available: true },
  { roomNumber: "102", type: "single", pricePerNight: 120, available: false },
  { roomNumber: "201", type: "double", pricePerNight: 180, available: true },
  { roomNumber: "202", type: "double", pricePerNight: 180, available: true },
  { roomNumber: "301", type: "suite", pricePerNight: 350, available: true },
];

// ─── Date Validation ──────────────────────────────────────────────────────────
//
// Strict YYYY-MM-DD check. The model often passes natural language dates
// ("next friday", "March 1") when the user speaks naturally — this is the
// primary error this concept demonstrates correcting.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

function checkAvailability(args: {
  check_in: string;
  check_out: string;
  room_type?: string;
}): string {
  if (!args.check_in) {
    return toolError("missing_required_field", "check_in is required");
  }
  if (!args.check_out) {
    return toolError("missing_required_field", "check_out is required");
  }

  const checkIn = parseDate(args.check_in);
  if (!checkIn) {
    return toolError("invalid_date_format", `check_in '${args.check_in}' is not a valid date`);
  }

  const checkOut = parseDate(args.check_out);
  if (!checkOut) {
    return toolError("invalid_date_format", `check_out '${args.check_out}' is not a valid date`);
  }

  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  if (nights <= 0) {
    return toolError(
      "checkout_before_checkin",
      `check_out '${args.check_out}' must be at least 1 day after check_in '${args.check_in}'`,
    );
  }

  if (args.room_type && !VALID_ROOM_TYPES.has(args.room_type)) {
    return toolError("unknown_room_type", `'${args.room_type}' is not a valid room type`);
  }

  let available = MOCK_ROOMS.filter((r) => r.available);
  if (args.room_type) {
    available = available.filter((r) => r.type === args.room_type);
  }

  if (available.length === 0) {
    return toolError("no_rooms_available", "No rooms available for those dates and room type");
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
  if (!args.room_type) {
    return toolError("missing_required_field", "room_type is required");
  }
  if (!VALID_ROOM_TYPES.has(args.room_type)) {
    return toolError("unknown_room_type", `'${args.room_type}' is not a valid room type`);
  }

  const price = ROOM_PRICES[args.room_type]!;
  const nights = parseInt(args.nights, 10);
  if (isNaN(nights) || nights <= 0) {
    return toolError(
      "missing_required_field",
      `nights must be a positive integer, got '${args.nights}'`,
    );
  }

  return JSON.stringify({
    room_type: args.room_type,
    pricePerNight: price,
    nights,
    totalPrice: price * nights,
    currency: "USD",
  });
}

function createReservation(args: {
  guest_name: string;
  room_type: string;
  check_in: string;
  check_out: string;
}): string {
  if (!args.guest_name?.trim()) {
    return toolError("missing_required_field", "guest_name is required");
  }
  if (!args.room_type) {
    return toolError("missing_required_field", "room_type is required");
  }
  if (!VALID_ROOM_TYPES.has(args.room_type)) {
    return toolError("unknown_room_type", `'${args.room_type}' is not a valid room type`);
  }

  const checkIn = parseDate(args.check_in);
  if (!checkIn) {
    return toolError("invalid_date_format", `check_in '${args.check_in}' is not a valid date`);
  }

  const checkOut = parseDate(args.check_out);
  if (!checkOut) {
    return toolError("invalid_date_format", `check_out '${args.check_out}' is not a valid date`);
  }

  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  if (nights <= 0) {
    return toolError(
      "checkout_before_checkin",
      `check_out '${args.check_out}' must be at least 1 day after check_in '${args.check_in}'`,
    );
  }

  // Simulate a race condition: room 201 is always "conflict" if another reservation
  // was just attempted. We check by looking at whether 201 is still available.
  const room = MOCK_ROOMS.find((r) => r.type === args.room_type && r.available);
  if (!room) {
    // This is a fatal error — room was taken since check_availability ran
    return toolError(
      "reservation_conflict",
      `All ${args.room_type} rooms were booked while you were deciding`,
    );
  }

  room.available = false;

  const pricePerNight = ROOM_PRICES[args.room_type] ?? 0;
  return JSON.stringify({
    success: true,
    reservation: {
      reservationId: `RES-${Date.now()}`,
      guestName: args.guest_name,
      roomNumber: room.roomNumber,
      roomType: args.room_type,
      checkIn: args.check_in,
      checkOut: args.check_out,
      nights,
      totalPrice: pricePerNight * nights,
    },
  });
}

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "check_availability":
      return checkAvailability(args as Parameters<typeof checkAvailability>[0]);
    case "get_room_price":
      return getRoomPrice(args as Parameters<typeof getRoomPrice>[0]);
    case "create_reservation":
      return createReservation(args as Parameters<typeof createReservation>[0]);
    default:
      return JSON.stringify({ error: "unknown_tool", message: `No tool named '${name}'` });
  }
}

// ─── State Reset (for /reset command) ────────────────────────────────────────

export function resetMockData(): void {
  MOCK_ROOMS[0]!.available = true;
  MOCK_ROOMS[1]!.available = false;
  MOCK_ROOMS[2]!.available = true;
  MOCK_ROOMS[3]!.available = true;
  MOCK_ROOMS[4]!.available = true;
}
