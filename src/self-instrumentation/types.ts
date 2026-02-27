export type {
  Role,
  ToolCall,
  Message,
  ToolParameter,
  ToolParameters,
  ToolDefinition,
} from "../shared/types.js";

// ─── Hotel Domain Types ───────────────────────────────────────────────────────

export interface Room {
  roomNumber: string;
  type: "single" | "double" | "suite";
  pricePerNight: number;
  available: boolean;
}

export interface Reservation {
  reservationId: string;
  guestName: string;
  roomNumber: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  nights: number;
}

// ─── Trace Summary ───────────────────────────────────────────────────────────

export interface TraceSummary {
  durationMs: number;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}
