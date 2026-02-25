import * as readline from "readline";
import type { Message } from "./types.js";
import { MODEL } from "./config.js";

// ─── CLI Factory ─────────────────────────────────────────────────────────────
//
// createCLI() builds a readline-based chat loop from a config object.
// Every concept demo shares the same skeleton: welcome → loop(read → agent → print).
// This factory owns all the boilerplate; each demo supplies only what's unique.

export interface CLIResponse {
  messages: Message[]; // updated history
  stats?: string[]; // optional lines printed after response
}

export interface CLIConfig {
  title: string; // welcome banner title
  emoji: string; // prefix emoji
  goodbye: string; // exit message
  agentLabel?: string; // "Agent" (default) or "Assistant"
  dividerWidth?: number; // default 50
  welcomeLines?: string[]; // extra lines after header
  inputPrompt?: string | (() => string); // dynamic prompt for error-recovery
  onMessage: (input: string, history: Message[]) => Promise<CLIResponse>;
  onCommand?: (
    command: string,
    history: Message[],
  ) => boolean | { handled: boolean; newHistory?: Message[] };
}

export function createCLI(config: CLIConfig) {
  const {
    title,
    emoji,
    goodbye,
    agentLabel = "Agent",
    dividerWidth = 50,
    welcomeLines = [],
    inputPrompt = "You: ",
    onMessage,
    onCommand,
  } = config;

  let history: Message[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function printDivider() {
    console.log("\n" + "─".repeat(dividerWidth));
  }

  function printWelcome() {
    console.log(`\n${emoji}  ${title}`);
    console.log(`    Powered by Ollama + ${MODEL}`);
    console.log('    Type "exit" to quit\n');
    for (const line of welcomeLines) {
      console.log(line);
    }
  }

  function printResponse(messages: Message[]) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant) {
      printDivider();
      console.log(`\n${agentLabel}: ${lastAssistant.content}`);
    }
  }

  function quit() {
    console.log(`\n${goodbye}\n`);
    rl.close();
  }

  function handleError(err: unknown): boolean {
    const error = err as Error;
    if (error.message?.includes("ECONNREFUSED")) {
      console.error("\n❌ Could not connect to Ollama.");
      console.error("   Make sure Ollama is running: ollama serve");
      console.error(`   And that you have the model pulled: ollama pull ${MODEL}\n`);
      rl.close();
      return false;
    }
    console.error("\n❌ Error:", error.message);
    return true;
  }

  async function chat() {
    printDivider();
    const prompt = typeof inputPrompt === "function" ? inputPrompt() : inputPrompt;
    process.stdout.write(prompt);

    rl.once("line", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return chat();
      if (trimmed.toLowerCase() === "exit") return quit();

      // Handle slash commands
      if (trimmed.startsWith("/") && onCommand) {
        const result = onCommand(trimmed, history);
        if (typeof result === "boolean") {
          if (!result) {
            console.log(`  Unknown command: ${trimmed}`);
          }
        } else {
          if (!result.handled) {
            console.log(`  Unknown command: ${trimmed}`);
          }
          if (result.newHistory) {
            history = result.newHistory;
          }
        }
        return chat();
      }

      try {
        const result = await onMessage(trimmed, history);
        history = result.messages;
        printResponse(history);
        if (result.stats) {
          for (const line of result.stats) {
            console.log(line);
          }
        }
      } catch (err) {
        if (!handleError(err)) return;
      }

      chat();
    });
  }

  return {
    start() {
      printWelcome();
      chat();
    },
  };
}
