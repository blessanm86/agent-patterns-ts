import { defineConfig } from 'evalite/config'

export default defineConfig({
  // Load .env before running evals so MODEL and OLLAMA_HOST are available
  setupFiles: ['dotenv/config'],
  // LLM calls are slow — give each test case 2 minutes
  testTimeout: 120_000,
})
