import { readOutbox } from "@/lib/server/dev-outbox";

/** GET /api/dev/outbox?to=+91…&channel=sms — mock SMS/email messages. Development and tests only. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const params = new URL(request.url).searchParams;
  const to = params.get("to") ?? undefined;
  const ch = params.get("channel");
  const channel = ch === "sms" || ch === "email" ? ch : undefined;
  return Response.json({ messages: readOutbox({ to, channel }) }, { headers: { "Cache-Control": "no-store" } });
}
