import { NextResponse, type NextRequest } from "next/server";

// Must match ADMIN_COOKIE in lib/server/admin/auth.ts (that module is server-only, so not imported here).
const ADMIN_COOKIE = "css_admin";

/**
 * Optimistic gate for /admin/*: bounces requests without a session cookie to the login page.
 * This is NOT authorization — every admin page, server action and route calls requireAdmin()/getCurrentAdmin().
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) return NextResponse.next();
  if (request.cookies.has(ADMIN_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL("/admin/login", request.url));
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
