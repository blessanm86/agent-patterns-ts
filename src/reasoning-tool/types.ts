export type {
  Role,
  ToolCall,
  Message,
  ToolParameter,
  ToolParameters,
  ToolDefinition,
} from "../shared/types.js";

// ─── Refund Domain Types ──────────────────────────────────────────────────────

export interface Order {
  orderId: string;
  customerName: string;
  item: string;
  amount: number;
  purchaseDate: string;
  status: "active" | "refunded" | "cancelled";
}

export interface RefundRecord {
  refundId: string;
  orderId: string;
  approved: boolean;
  reason: string;
  processedAt: string;
}
