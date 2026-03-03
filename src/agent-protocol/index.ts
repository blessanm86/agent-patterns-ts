import "dotenv/config";
import { MODEL } from "../shared/config.js";
import { AgentServer } from "./protocol.js";
import { startHttpTransport } from "./transport-http.js";
import { startStdioTransport } from "./transport-stdio.js";

// ─── Entry Point ─────────────────────────────────────────────────────────────
//
// Three modes:
//   --mode=server-http   (default) — web browser experience at localhost:3009
//   --mode=server-stdio  — raw protocol over stdin/stdout (used by CLI client)
//   --mode=cli           — terminal client (spawns server-stdio as child process)

const PORT = 3009;

function getMode(): string {
  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  return modeArg ? modeArg.split("=")[1] : "server-http";
}

async function main() {
  const mode = getMode();

  if (mode === "cli") {
    // CLI client — dynamic import to avoid loading child-process code in server mode
    await import("./client-cli.js");
    return;
  }

  // Both server modes share the same AgentServer instance
  const server = new AgentServer();

  if (mode === "server-stdio") {
    startStdioTransport(server);
  } else {
    console.log(`  Model: ${MODEL}`);
    startHttpTransport(server, PORT);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
