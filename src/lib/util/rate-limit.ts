// Durable, Postgres-backed IP rate limiter. The previous in-memory Map reset on
// every container restart and couldn't coordinate across replicas; the rate_limit
// table makes the window survive restarts and work for any number of instances.
// Expired rows are harmless (they're reset on the next hit for the same key) and
// can be swept by a periodic job via the idx_rate_limit_expires_at index.
import { db } from "@/db";
import { rateLimit as rateLimitTable } from "@/db/schema";
import { sql } from "drizzle-orm";

export type RateLimitResult = {
  success: boolean;
  count: number;
  limit: number;
  resetTime: number;
};

/**
 * Throttle by client IP, durably. One ATOMIC upsert per call: a fresh or expired key
 * starts a new window at count 1; a live key increments. `success` is count <= limit.
 *
 * Fail-OPEN on a DB error — a limiter/DB hiccup must never take down the endpoints it
 * is meant to protect (rate limiting is an abuse control, not an auth gate).
 *
 * Defaults to 60 requests per 60s window.
 */
export async function rateLimit(ip: string, limit: number = 60, windowMs: number = 60000): Promise<RateLimitResult> {
  const intervalSec = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    const rows = await db.execute<{ count: number; expires_at: string | Date }>(sql`
      INSERT INTO ${rateLimitTable} ("key", "count", "expires_at")
      VALUES (${ip}, 1, now() + (${intervalSec} * interval '1 second'))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN ${rateLimitTable}."expires_at" < now() THEN 1 ELSE ${rateLimitTable}."count" + 1 END,
        "expires_at" = CASE WHEN ${rateLimitTable}."expires_at" < now() THEN now() + (${intervalSec} * interval '1 second') ELSE ${rateLimitTable}."expires_at" END
      RETURNING "count", "expires_at"
    `);
    const row = rows[0];
    const count = Number(row?.count ?? 1);
    const resetTime = row?.expires_at ? new Date(row.expires_at).getTime() : Date.now() + windowMs;
    return { success: count <= limit, count, limit, resetTime };
  } catch (e) {
    // Fail open: never let a limiter/DB error block legitimate traffic.
    console.error("rateLimit DB error; failing open:", e);
    return { success: true, count: 0, limit, resetTime: Date.now() + windowMs };
  }
}

/**
 * Safely extracts the client IP from request headers.
 *
 * SECURITY: prefer X-Real-IP — our nginx OVERWRITES it with the real $remote_addr,
 * so it can't be spoofed. X-Forwarded-For is only safe at its LAST hop: nginx
 * APPENDS the real IP (proxy_add_x_forwarded_for), so the leftmost entries are
 * attacker-supplied. Never trust xff[0] — a spoofed value would mint a fresh
 * rate-limit bucket per request and forge the IP written to the audit log.
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "127.0.0.1";
}
