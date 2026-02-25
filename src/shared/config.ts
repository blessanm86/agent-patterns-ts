// ─── Model Configuration ─────────────────────────────────────────────────────
//
// Single source of truth for the Ollama model name.
// Set via .env (MODEL=qwen2.5:14b) — no code changes needed to swap models.

export const MODEL = process.env.MODEL ?? "qwen2.5:7b";
