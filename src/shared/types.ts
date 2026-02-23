// ─── Message Types ────────────────────────────────────────────────────────────

export type Role = 'user' | 'assistant' | 'tool'

export interface ToolCall {
  function: {
    name: string
    arguments: Record<string, string>
  }
}

export interface Message {
  role: Role
  content: string
  tool_calls?: ToolCall[]
}

// ─── Tool Types ───────────────────────────────────────────────────────────────

export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
}

export interface ToolParameters {
  type: 'object'
  properties: Record<string, ToolParameter>
  required: string[]
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolParameters
  }
}
