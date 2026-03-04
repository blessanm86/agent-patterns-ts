// ─── User Model ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export type UserRole = "customer" | "admin" | "vendor";

export interface CreateUserInput {
  email: string;
  name: string;
  role?: UserRole;
}

export function createUser(data: CreateUserInput): User {
  return {
    id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: data.email,
    name: data.name,
    role: data.role ?? "customer",
    createdAt: new Date(),
  };
}

export function isAdmin(user: User): boolean {
  return user.role === "admin";
}

export function formatUserDisplay(user: User): string {
  return `${user.name} <${user.email}> [${user.role}]`;
}
