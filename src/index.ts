import * as readline from 'readline'
import { runAgent } from './agent.js'
import type { Message } from './types.js'

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────
//
// Maintains conversation history across turns so the agent remembers
// everything said so far. Each call to runAgent appends to this history.

let history: Message[] = []

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function printDivider() {
  console.log('\n' + '─'.repeat(50))
}

function printWelcome() {
  console.log('\n🏨  The Grand TypeScript Hotel — Reservation Agent')
  console.log('    Powered by Ollama + ' + (process.env.MODEL ?? 'qwen2.5:7b'))
  console.log('    Type "exit" to quit\n')
  console.log('💡  Tool calls will be shown in the console so you can see the ReAct loop in action.')
}

function printResponse(history: Message[]) {
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')
  if (lastAssistant) {
    printDivider()
    console.log(`\nAgent: ${lastAssistant.content}`)
  }
}

function quit() {
  console.log('\nGoodbye! 🏨\n')
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
      history = await runAgent(trimmed, history)
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
