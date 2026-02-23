import * as readline from 'readline'
import { runPlanExecuteAgent } from './agent.js'
import type { Message } from '../shared/types.js'

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────
//
// Same structure as src/index.ts — maintains conversation history across turns.
// Each call to runPlanExecuteAgent appends to this history.

let history: Message[] = []

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function printDivider() {
  console.log('\n' + '─'.repeat(50))
}

function printWelcome() {
  console.log('\n✈️   Trip Planner — Plan+Execute Agent')
  console.log('    Powered by Ollama + ' + (process.env.MODEL ?? 'qwen2.5:7b'))
  console.log('    Type "exit" to quit\n')
  console.log('💡  This agent uses the Plan+Execute pattern:')
  console.log('    1. It creates a full research plan BEFORE calling any tools')
  console.log('    2. Then executes all tool calls mechanically')
  console.log('    3. Finally synthesizes the results into an itinerary\n')
  console.log('    Try: "Plan a 3-day trip to Paris from New York, departing 2026-07-10"')
}

function printResponse(history: Message[]) {
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant' && m.content)
  if (lastAssistant) {
    printDivider()
    console.log(`\nAgent: ${lastAssistant.content}`)
  }
}

function quit() {
  console.log('\nSafe travels! ✈️\n')
  rl.close()
}

function handleError(err: unknown): boolean {
  const error = err as Error
  if (error.message?.includes('ECONNREFUSED')) {
    console.error('\n❌ Could not connect to Ollama.')
    console.error('   Make sure Ollama is running: ollama serve')
    console.error(`   And that you have the model pulled: ollama pull ${process.env.MODEL ?? 'qwen2.5:7b'}\n`)
    rl.close()
    return false
  }
  console.error('\n❌ Error:', error.message)
  return true
}

async function chat() {
  printDivider()
  process.stdout.write('You: ')

  rl.once('line', async (input) => {
    const trimmed = input.trim()
    if (!trimmed) return chat()
    if (trimmed.toLowerCase() === 'exit') return quit()

    try {
      history = await runPlanExecuteAgent(trimmed, history)
      printResponse(history)
    } catch (err) {
      if (!handleError(err)) return
    }

    chat()
  })
}

// ─── Start ────────────────────────────────────────────────────────────────────

printWelcome()
chat()
