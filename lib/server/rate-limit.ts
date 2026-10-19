import "server-only";
import { db } from "./db";
import { ApiException } from "./http";

/**
 * Fixed-window rate limit stored in Postgres, so it holds across serverless instances.
 * Returns whether this hit is allowed; increments atomically.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  const retryAfter = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now) / 1000);
  return { allowed: count <= limit, count, retryAfter };
}

/** Throws a 429 ApiException when over the limit. */
export async function enforceRateLimit(key: string, limit: number, windowSeconds: number, message?: string) {
  const r = await rateLimit(key, limit, windowSeconds);
  if (!r.allowed) {
    throw new ApiException(
      429,
      "RATE_LIMITED",
      message ?? "Too many attempts. Please wait a few minutes and try again.",
      undefined,
      { "Retry-After": String(r.retryAfter) },
    );
  }
}

/** Housekeeping: delete windows older than a day. Called from the cron job. */
export async function pruneRateLimits() {
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } });
}
