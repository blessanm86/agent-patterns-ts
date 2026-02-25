import * as readline from "readline";
import {
  extractWithPromptOnly,
  extractWithJsonMode,
  extractWithSchemaMode,
  extractAll,
} from "./agent.js";
import type { Approach, ExtractionResult, BookingIntent } from "./agent.js";

// ─── State ────────────────────────────────────────────────────────────────────

let mode: Approach = "schema";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ─── Display Helpers ──────────────────────────────────────────────────────────

function printDivider() {
  console.log("\n" + "─".repeat(60));
}

function modeLabel(m: Approach): string {
  return { prompt: "💬 prompt-only", "json-mode": "📋 json-mode", schema: "🔒 schema" }[m];
}

function printWelcome() {
  console.log("\n🏨  Structured Output Demo — Booking Intent Extractor");
  console.log("    Powered by Ollama + " + (process.env.MODEL ?? "qwen2.5:7b"));
  console.log(`    Current mode: ${modeLabel(mode)}\n`);
  console.log("  Commands:");
  console.log("    /schema     — constrained decoding (default, most reliable)");
  console.log("    /json-mode  — format:json (valid syntax, schema not guaranteed)");
  console.log("    /prompt     — prompt-only (no format constraint, least reliable)");
  console.log("    /all        — compare all three approaches on the same input");
  console.log("    exit        — quit\n");
  console.log("  Try these inputs:");
  console.log('    "Book a double room for John Smith, March 15 to March 20, 2 adults"');
  console.log('    "Suite for Alice Wong checking in April 1st, out April 5th"');
  console.log('    "single room 2026-06-01 to 2026-06-03 for Ben Lee, quiet floor please"\n');
}

function printBooking(data: BookingIntent) {
  const sr = data.special_requests.trim() || "(none)";
  console.log("\n  Extracted:");
  console.log(`    guest_name:       ${data.guest_name}`);
  console.log(`    room_type:        ${data.room_type}`);
  console.log(`    check_in:         ${data.check_in}`);
  console.log(`    check_out:        ${data.check_out}`);
  console.log(`    adults:           ${data.adults}`);
  console.log(`    special_requests: ${sr}`);
}

function printResult(result: ExtractionResult) {
  printDivider();
  console.log(`\n[${modeLabel(result.approach)}]\n`);

  const preview =
    result.rawResponse.length > 200 ? result.rawResponse.slice(0, 200) + "…" : result.rawResponse;
  console.log(`  Raw:  ${preview}\n`);

  if (result.jsonParseError !== null) {
    console.log(`  ❌ JSON parse failed  — ${result.jsonParseError}`);
    console.log("  ⏭  Zod validation     — skipped");
    return;
  }

  console.log("  ✅ JSON parse         — ok");

  if (result.validationError !== null) {
    console.log(`  ❌ Zod validation     — ${result.validationError}`);
    return;
  }

  console.log("  ✅ Zod validation     — ok");
  printBooking(result.data!);
}

// ─── Comparison Table (for /all) ──────────────────────────────────────────────

function printComparison(results: ExtractionResult[]) {
  printDivider();
  console.log("\n  Comparing all three approaches:\n");

  const col = (s: string, w: number) => s.slice(0, w).padEnd(w);

  console.log(
    "  " + col("Approach", 12) + col("JSON Parse", 12) + col("Zod Schema", 12) + "Outcome",
  );
  console.log("  " + "─".repeat(58));

  for (const r of results) {
    let jsonCol: string;
    let zodCol: string;
    let outcome: string;

    if (r.jsonParseError !== null) {
      jsonCol = "FAILED";
      zodCol = "(skipped)";
      outcome = "✗ JSON parse error";
    } else if (r.validationError !== null) {
      jsonCol = "ok";
      zodCol = "FAILED";
      const firstIssue = r.validationError.split(";")[0].trim();
      outcome = `✗ ${firstIssue}`;
    } else {
      jsonCol = "ok";
      zodCol = "ok";
      outcome = `✓ ${r.data!.guest_name} / ${r.data!.room_type} / ${r.data!.check_in}`;
    }

    console.log("  " + col(r.approach, 12) + col(jsonCol, 12) + col(zodCol, 12) + outcome);
  }

  // Print full extraction from the best result (prefer schema, then any success)
  const best =
    results.find((r) => r.approach === "schema" && r.data !== null) ??
    results.find((r) => r.data !== null);

  if (best?.data) {
    console.log(`\n  Full extraction (${best.approach}):`);
    printBooking(best.data);
  }
}

// ─── Command Handler ──────────────────────────────────────────────────────────

function handleCommand(input: string): boolean {
  switch (input) {
    case "/schema":
      mode = "schema";
      console.log(`\nMode: ${modeLabel(mode)} — constrained decoding, most reliable`);
      return true;
    case "/json-mode":
      mode = "json-mode";
      console.log(`\nMode: ${modeLabel(mode)} — valid JSON syntax, schema not guaranteed`);
      return true;
    case "/prompt":
      mode = "prompt";
      console.log(`\nMode: ${modeLabel(mode)} — no format constraint, prone to failures`);
      return true;
    default:
      return false;
  }
}

// ─── Error Handler ────────────────────────────────────────────────────────────

function handleError(err: unknown): boolean {
  const error = err as Error;
  if (error.message?.includes("ECONNREFUSED")) {
    console.error("\n❌ Could not connect to Ollama.");
    console.error("   Make sure Ollama is running: ollama serve");
    console.error(
      `   And that you have the model pulled: ollama pull ${process.env.MODEL ?? "qwen2.5:7b"}\n`,
    );
    rl.close();
    return false;
  }
  console.error("\n❌ Error:", error.message);
  return true;
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

function chat() {
  printDivider();
  process.stdout.write(`\nYou [${mode}] (or /all): `);

  rl.once("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return chat();

    if (trimmed.toLowerCase() === "exit") {
      console.log("\nGoodbye! 🏨\n");
      rl.close();
      return;
    }

    // ── /all: prompt for message, then run all three ──────────────────────────
    if (trimmed === "/all") {
      process.stdout.write("\nMessage to extract (all three modes): ");
      rl.once("line", async (msg) => {
        const message = msg.trim();
        if (!message) return chat();
        try {
          console.log("\n  Running all three approaches...");
          const results = await extractAll(message);
          printComparison(results);
        } catch (err) {
          if (!handleError(err)) return;
        }
        chat();
      });
      return;
    }

    // ── Slash commands ────────────────────────────────────────────────────────
    if (trimmed.startsWith("/")) {
      if (!handleCommand(trimmed)) {
        console.log(`\nUnknown command: ${trimmed}`);
        console.log("  Available: /schema, /json-mode, /prompt, /all");
      }
      return chat();
    }

    // ── Extract with current mode ─────────────────────────────────────────────
    try {
      let result: ExtractionResult;
      if (mode === "prompt") {
        result = await extractWithPromptOnly(trimmed);
      } else if (mode === "json-mode") {
        result = await extractWithJsonMode(trimmed);
      } else {
        result = await extractWithSchemaMode(trimmed);
      }
      printResult(result);
    } catch (err) {
      if (!handleError(err)) return;
    }

    chat();
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

printWelcome();
chat();
