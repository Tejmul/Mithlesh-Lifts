import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/server/booking-session";
import { logoutCustomer } from "@/lib/server/customer-auth";
import { assertSameOrigin, handler } from "@/lib/server/http";

/** POST /api/account/logout → 204. Also drops the /book session so the next visitor starts fresh. */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  await logoutCustomer();
  (await cookies()).delete({ name: SESSION_COOKIE, path: "/" });
  return new Response(null, { status: 204 });
});
