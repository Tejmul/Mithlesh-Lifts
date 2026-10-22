import { PrismaPg } from "@prisma/adapter-pg";

/** Same TLS handling as lib/server/db.ts (that module is server-only): DATABASE_CA_CERT for Aiven-style CAs. */
export function pgAdapter(connectionString: string) {
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  if (!ca) return new PrismaPg({ connectionString });
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  return new PrismaPg({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } });
}
