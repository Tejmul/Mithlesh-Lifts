# Mithilesh Lifts

Coaching site for Mithilesh Reddy (@mithilesh_lifts): landing page, paid plans (Razorpay),
free consultation (Calendly), and a slot-booking calendar.

## Run it

```bash
cp .env.example .env.local   # then fill in the keys
npm install
npm run dev                  # http://localhost:3000
```

## Where to change things

| What | File |
|---|---|
| Plan names, prices, inclusions | `lib/plans.ts` |
| Booking hours, slot length, days ahead | `lib/booking.ts` |
| Client results (photos in `public/results/`) | `lib/site.ts` |
| Styles / design tokens | `app/globals.css` |

## Payments (Razorpay)

1. Get API keys from dashboard.razorpay.com → Account & Settings → API Keys.
2. Put them in `.env.local` as `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. Use `rzp_test_` keys first.
3. Flow: Pay → Razorpay checkout → server verifies the signature → client lands on
   `/book?payment=…` to book an onboarding call.

Until keys are set, Pay buttons show "Online payment isn't set up yet" with a DM link.

## Calendly

Set `NEXT_PUBLIC_CALENDLY_URL` to the free-call event link. Without it, the section points to `/book`.

## Bookings and payments storage

Stored as JSON in `data/` (gitignored) — fine for local use and a single server.
**Before deploying to Vercel or any serverless host, move `lib/store.ts` to a real database**,
because files written at runtime there are not kept.
# Mithlesh-Lifts
