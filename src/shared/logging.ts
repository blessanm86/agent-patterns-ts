// ─── Tool Call Logging ───────────────────────────────────────────────────────
//
// Shared console output for tool calls across all agent demos.
// Keeps the format consistent: emoji marker, indented args, result preview.

export interface LogToolCallOptions {
  maxResultLength?: number; // Truncate result after this many chars (default: no truncation)
}

export function logToolCall(
  name: string,
  args: Record<string, string>,
  result: string,
  options?: LogToolCallOptions,
): void {
  console.log(`\n  🔧 Tool call: ${name}`);
  console.log(`     Args: ${JSON.stringify(args, null, 2).replace(/\n/g, "\n     ")}`);

  const display =
    options?.maxResultLength && result.length > options.maxResultLength
      ? `${result.slice(0, options.maxResultLength)}...`
      : result;
  console.log(`     Result: ${display}`);
}
