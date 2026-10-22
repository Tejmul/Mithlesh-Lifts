import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Connections per server instance. Vercel runs many instances at once under traffic; a small pool
 * keeps the total under the database's connection limit (Aiven's small plans allow few). Raise it
 * with DATABASE_POOL_MAX, or point DATABASE_URL at Aiven's PgBouncer pool for heavy traffic.
 */
const POOL_MAX = Math.max(1, Number(process.env.DATABASE_POOL_MAX) || 3);

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // Managed Postgres with its own CA (e.g. Aiven): paste the CA certificate (PEM) into DATABASE_CA_CERT.
  // TLS is then verified against that CA; sslmode is dropped from the URL so it can't override this.
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  if (ca) {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    return new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true }, max: POOL_MAX }),
    });
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: POOL_MAX }) });
}

/** Shared Prisma client. Reused across hot reloads in development. */
export const db: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * Interactive-transaction limits. Prisma's defaults (2s to acquire, 5s to run) are too tight when
 * a burst of visitors races for the same slot: losers wait on the exclusion constraint's lock.
 */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;

/** Transaction client type, for functions that must run inside a caller's transaction. */
export type Tx = Prisma.TransactionClient;

/** Postgres SQLSTATE for an exclusion-constraint violation (our overlap guard). */
export const EXCLUSION_VIOLATION = "23P01";

/** True when an error came from the Booking_no_overlap exclusion constraint or a unique violation. */
export function isConstraintViolation(err: unknown, code: "23P01" | "P2002"): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; meta?: { code?: string }; cause?: { code?: string }; message?: string };
  if (code === "P2002") return e.code === "P2002";
  return (
    e.code === code ||
    e.meta?.code === code ||
    e.cause?.code === code ||
    (typeof e.message === "string" && e.message.includes("Booking_no_overlap"))
  );
}

/** Postgres deadlock (40P01) or serialization failure (40001); Prisma reports these as P2034. */
export function isTransactionConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; meta?: { code?: string }; cause?: { code?: string }; message?: string };
  const codes = [e.code, e.meta?.code, e.cause?.code];
  return (
    codes.some((c) => c === "P2034" || c === "40P01" || c === "40001") ||
    (typeof e.message === "string" && /deadlock detected|could not serialize/i.test(e.message))
  );
}

/** Prisma couldn't start or finish an interactive transaction in time (P2028). */
export function isTransactionTimeout(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "P2028");
}
