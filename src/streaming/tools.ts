// ─── Tool Re-export ──────────────────────────────────────────────────────────
//
// Streaming uses the same hotel tools as the ReAct demo.
// The agent logic is different (streaming vs blocking), but the tools are identical.

export { tools, executeTool } from "../react/tools.js";
