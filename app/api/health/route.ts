import { connection } from "next/server";
import { db } from "@/lib/server/db";
import { reportError } from "@/lib/server/observability";

/** Liveness + database check for uptime monitors. Reveals nothing about configuration. */
export async function GET() {
  await connection(); // always request-time, never prerendered
  const time = new Date().toISOString();
  const headers = { "Cache-Control": "no-store" };
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok", time }, { headers });
  } catch (err) {
    reportError(err, { where: "health" });
    return Response.json({ status: "degraded", db: "error", time }, { status: 503, headers });
  }
}
