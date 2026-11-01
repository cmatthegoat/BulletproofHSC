import { AppError } from "./errors";
import { hashPassword, verifyPassword, newSessionToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "session";
export const SESSION_DAYS = 30;

export async function createUser(db: D1Database, email: string, password: string): Promise<number> {
  const existing = await db.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) throw new AppError(409, "email_taken", "An account with this email already exists.");
  const { hash, salt } = await hashPassword(password);
  const row = await db
    .prepare(`INSERT INTO users (email, password_hash, password_salt) VALUES (?, ?, ?) RETURNING id`)
    .bind(email, hash, salt)
    .first<{ id: number }>();
  if (!row) throw new AppError(500, "internal_error", "Could not create account.");
  return row.id;
}

// Returns the user id on success. The same error is used for unknown email and wrong password.
export async function checkLogin(db: D1Database, email: string, password: string): Promise<number> {
  const row = await db
    .prepare(`SELECT id, password_hash, password_salt FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: number; password_hash: string; password_salt: string }>();
  const ok = row ? await verifyPassword(password, row.password_hash, row.password_salt) : false;
  if (!row || !ok) throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
  return row.id;
}

export async function createSession(db: D1Database, userId: number, now = Date.now()): Promise<string> {
  const token = newSessionToken();
  const expires = new Date(now + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)`)
    .bind(userId, await sha256Hex(token), expires)
    .run();
  return token;
}

export async function findSessionUser(db: D1Database, token: string, now = Date.now()): Promise<number | null> {
  const row = await db
    .prepare(`SELECT user_id, expires_at FROM sessions WHERE token_hash = ?`)
    .bind(await sha256Hex(token))
    .first<{ user_id: number; expires_at: string }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now) return null;
  return row.user_id;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256Hex(token)).run();
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
