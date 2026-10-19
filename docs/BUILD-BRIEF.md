# Build brief (shared by all build agents)

Product: sales-call booking for fitness coach Mithilesh Reddy (Coach Scale Systems, "CSS").
Visitors arrive from a ManyChat link: /book?source=manychat&campaign=<name>&mc=<subscriber id>.

Customer flow (one page, /book):
1. Phone: country code + mobile → "Send code" → enter OTP → verified.
2. Contact: full name + email (+ optional marketing opt-in).
3. Pick a slot on a calendar (shown in the visitor's time zone, selectable).
4. Review → "Book my call" → confirmation screen (refresh-safe) + email.
Price/plans are NOT part of booking; Mithilesh quotes on the call.

Providers: phone OTP = Twilio Verify or MSG91 OTP (provider generates + checks codes; we never store OTPs).
Email = Resend. Dev/test use "mock" providers that write to lib/server/dev-outbox.ts (never in production).

Contracts (do not change signatures without telling the lead):
- lib/shared/api.ts — HTTP request/response types and error codes.
- lib/shared/validation.ts — zod schemas shared by client and server.
- Cross-module server functions are declared in stub files owned by one agent each:
  lib/server/phone-verify/index.ts, lib/server/booking-session.ts (A);
  lib/server/scheduling/availability.ts, lib/server/bookings/service.ts (B);
  lib/server/email/index.ts, lib/server/notifications/index.ts (C);
  lib/server/admin/auth.ts (D).
Core helpers (read-only for agents): lib/server/{db,env,crypto,http,rate-limit,settings,observability,dev-outbox}.ts.

Rules: strict TypeScript; `import "server-only"` in server modules; Prisma client from
"@/generated/prisma/client" via `db` in lib/server/db.ts; route handlers wrapped in `handler()` from
lib/server/http.ts, cookie-authenticated mutations call `assertSameOrigin(request)`; validate with
`parseBody(request, schema)`; never log OTPs, tokens, phone numbers or emails; errors use apiError codes.
Next.js 16 App Router: read node_modules/next/dist/docs before using unfamiliar APIs
(cookies() is async; page params/searchParams are Promises; use `after` from next/server).
DB: Postgres in Docker (localhost:5433). Dev DB css_dev, test DB css_test. Tests: `npx vitest run <path>`
(see vitest.config.ts, tests/helpers/*). Booking overlap is enforced by the Booking_no_overlap
exclusion constraint (SQLSTATE 23P01) — see prisma/migrations.
