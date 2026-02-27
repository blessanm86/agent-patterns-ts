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

// ─── Model Tier Types ─────────────────────────────────────────────────────────

export type ModelTier = "fast" | "standard" | "capable";

export interface ModelConfig {
  name: string;
  tier: ModelTier;
  inputCostPer1M: number;
  outputCostPer1M: number;
}

export interface CostRecord {
  model: string;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  purpose: string;
}

export interface CostSummary {
  records: CostRecord[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  baselineCost: number;
  savingsPercent: number;
}
