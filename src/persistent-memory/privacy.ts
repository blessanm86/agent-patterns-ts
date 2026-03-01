// ─── PII Detection ──────────────────────────────────────────────────────────
//
// Regex-based privacy filter that prevents sensitive data from being stored
// as memory facts. Checks for common PII patterns: SSN, credit cards, email
// addresses, phone numbers, and password-like strings.
//
// Facts that fail the check are logged but never persisted.

interface PIIPattern {
  name: string;
  regex: RegExp;
}

const PII_PATTERNS: PIIPattern[] = [
  { name: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: "credit-card", regex: /\b(?:\d[ -]*?){13,19}\b/ },
  { name: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { name: "phone", regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  {
    name: "password",
    regex: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i,
  },
];

export interface PIICheckResult {
  isSafe: boolean;
  flaggedPatterns: string[];
}

export function checkForPII(text: string): PIICheckResult {
  const flaggedPatterns: string[] = [];

  for (const pattern of PII_PATTERNS) {
    if (pattern.regex.test(text)) {
      flaggedPatterns.push(pattern.name);
    }
  }

  return {
    isSafe: flaggedPatterns.length === 0,
    flaggedPatterns,
  };
}
