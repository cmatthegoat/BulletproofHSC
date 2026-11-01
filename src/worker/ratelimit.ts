import { AppError } from "./errors";

export interface RateRule {
  action: string;
  limit: number;
  windowSeconds: number;
}

// Fixed-window counter per (action, ip). Returns once allowed or throws 429.
export async function enforceRateLimit(db: D1Database, ip: string, rule: RateRule, now = Date.now()): Promise<void> {
  const windowStart = Math.floor(now / 1000 / rule.windowSeconds) * rule.windowSeconds;
  const key = `${rule.action}:${ip}:${windowStart}`;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  // Opportunistic cleanup of expired windows keeps the table small on the free tier.
  await db.prepare(`DELETE FROM rate_limits WHERE window_start < ?`).bind(windowStart - rule.windowSeconds * 2).run();
  if (row && row.count > rule.limit) {
    throw new AppError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  }
}
