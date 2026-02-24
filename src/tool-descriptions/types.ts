export type {
  Role,
  ToolCall,
  Message,
  ToolParameter,
  ToolParameters,
  ToolDefinition,
} from "../shared/types.js";

// ─── Customer Support Domain Types ───────────────────────────────────────────

export interface Order {
  orderId: string;
  customerName: string;
  customerEmail: string;
  item: string;
  amount: number;
  purchaseDate: string;
  status: "active" | "refunded" | "cancelled";
}

export interface SupportTicket {
  ticketId: string;
  orderId: string;
  status: "open" | "resolved" | "escalated";
  priority: "low" | "medium" | "high";
  notes: string;
}
