import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
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
