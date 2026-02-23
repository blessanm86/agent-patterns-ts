import ollama from 'ollama'
import { tools, executeTool } from './tools.js'
import type { Message } from './types.js'

// ─── System Prompt ────────────────────────────────────────────────────────────
//
// This shapes how the agent behaves throughout the conversation.
// A clear, specific system prompt is one of the most important parts
// of building a reliable agent.

const SYSTEM_PROMPT = `You are a friendly hotel reservation assistant for The Grand TypeScript Hotel.

Your goal is to help guests make a room reservation. Follow these steps in order:

1. Greet the guest and ask for their name
2. Ask for their desired check-in and check-out dates
3. Use the check_availability tool to find available rooms
4. Present the options clearly (room types and prices)
5. Ask the guest which room type they'd like
6. Use get_room_price to confirm the total cost and present it to the guest
7. Ask for confirmation before proceeding
8. Once confirmed, use create_reservation to book the room
9. Confirm the booking with the reservation ID

Important rules:
- Always use tools to check real availability and prices — never make up numbers
- If no rooms are available, suggest different dates
- Be concise and friendly
- Dates should be in YYYY-MM-DD format when calling tools`

// ─── Agent ────────────────────────────────────────────────────────────────────

const MODEL = process.env.MODEL ?? 'qwen2.5:7b'

export async function runAgent(userMessage: string, history: Message[]): Promise<Message[]> {
  // Build the full message history including the new user message
  const messages: Message[] = [...history, { role: 'user', content: userMessage }]

  // ── The ReAct Loop ──────────────────────────────────────────────────────────
  //
  // ReAct = Reason + Act
  //
  // Each iteration:
  //   1. Model REASONS about the conversation and decides what to do next
  //   2. If it needs info → it ACTs by calling a tool
  //   3. We execute the tool and feed the result back
  //   4. Loop until the model has enough info to respond directly to the user
  //
  // This loop is the entire "agent" — there's no magic, just iteration.

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    })

    const assistantMessage = response.message

    // Add assistant's response (with or without tool calls) to history
    messages.push(assistantMessage)

    // ── No tool calls → agent is done reasoning, reply to user ───────────────
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break
    }

    // ── Tool calls → execute each one and feed results back ──────────────────
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function

      console.log(`\n  🔧 Tool call: ${name}`)
      console.log(`     Args: ${JSON.stringify(args, null, 2).replace(/\n/g, '\n     ')}`)

      const result = executeTool(name, args as Record<string, string>)

      console.log(`     Result: ${result}`)

      // Tool results go back into the message history
      // The model will see these on the next iteration and reason about them
      messages.push({
        role: 'tool',
        content: result,
      })
    }

    // Loop back — model now reasons about the tool results
  }

  return messages
}
