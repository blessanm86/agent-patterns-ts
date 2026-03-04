// ─── Authentication Service ─────────────────────────────────────────────────

import type { User, CreateUserInput } from "../models/user.js";
import { createUser } from "../models/user.js";
import { validateEmail, validatePassword } from "../utils/validators.js";

export interface AuthConfig {
  tokenExpiryMs: number;
  maxLoginAttempts: number;
}

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  tokenExpiryMs: 3600000, // 1 hour
  maxLoginAttempts: 5,
};

const users = new Map<string, { user: User; passwordHash: string }>();
const tokens = new Map<string, { userId: string; expiresAt: number }>();

export function registerUser(input: CreateUserInput, password: string): User | { error: string } {
  if (!validateEmail(input.email)) {
    return { error: "Invalid email format" };
  }
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    return { error: passwordCheck.reason! };
  }
  if (users.has(input.email)) {
    return { error: "Email already registered" };
  }

  const user = createUser(input);
  users.set(input.email, { user, passwordHash: simpleHash(password) });
  return user;
}

export function authenticate(
  email: string,
  password: string,
): { token: string; user: User } | { error: string } {
  const record = users.get(email);
  if (!record || record.passwordHash !== simpleHash(password)) {
    return { error: "Invalid credentials" };
  }

  const token = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  tokens.set(token, {
    userId: record.user.id,
    expiresAt: Date.now() + DEFAULT_AUTH_CONFIG.tokenExpiryMs,
  });

  return { token, user: record.user };
}

export function validateToken(token: string): User | null {
  const session = tokens.get(token);
  if (!session || session.expiresAt < Date.now()) {
    tokens.delete(token);
    return null;
  }

  for (const record of users.values()) {
    if (record.user.id === session.userId) return record.user;
  }
  return null;
}

function simpleHash(input: string): string {
  let hash = 0;
  for (const char of input) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }
  return hash.toString(36);
}
