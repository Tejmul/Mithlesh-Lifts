# Product flow (source of truth)

This is the flow the owner wants. Read this before changing anything in the customer journey,
the account area, quotes, payments, or the admin panel. If code and this file disagree,
this file wins. Change it only when the owner changes the flow.

Last confirmed with the owner: 2026-10-22.

---

## The whole journey in one picture

```
Instagram DM ─► ManyChat asks its questions ─► sends link  /book?source=manychat&campaign=…&mc=…
                                                         │
                                                         ▼
 CUSTOMER   /book      ① Mobile number ─► OTP code ─► ② pick day + time ─► "Book"
                                                         │  (booking = account created + logged in)
                                                         ▼
            /account   ③ "You're booked" + optional email box   (bell in navbar from now on)
                                                         │
 SALES TEAM            ④ phones the customer at the booked time, negotiates a price
                                                         │
 ADMIN      /admin     ⑤ opens the customer ─► "Send quote": plan + ₹ amount + plan length
                                                         │
 CUSTOMER   /account   ⑥ notification "Your plan quote is ready" ─► View ─► Pay (Razorpay)
                                                         │
 ADMIN      /admin/clients ⑦ row: name · ID · plan · ₹ paid · paid on · valid from → valid until
                                                         └─ admin can edit the dates / extend the plan
```

## Step by step

### ① Landing from ManyChat — `/book`
- ManyChat asks its own questions in Instagram DMs, then sends the website link.
- The link goes **straight to the booking card**, not the home page. Tracking params
  (`source`, `campaign`, `mc` = ManyChat subscriber id) are kept on the lead.
- The first thing on screen is **one field: mobile number** (country code defaults to +91).
  Button: "Get OTP". Then the 6-digit code.
- **No "Sign up" vs "Log in" choice. No name field.** New and returning people use the same
  box. The phone number *is* the account.
  - Returning person with an upcoming call → sent to `/account` (they're logged in).
  - Anyone else → calendar.

### ② Pick a time — `/book` (same card)
- Simple day strip + time buttons, in the visitor's time zone.
- One button: "Book Tue 28 Oct · 6:30 pm".
- Booking creates/updates the account (Lead) and **logs the customer in** (30-day cookie).
- No prices, no plans anywhere in this part of the site. The price is decided on the call.

### ③ Booked → logged in — `/account`
- After booking, go to `/account` (not a separate confirmation page). Top of the page:
  "You're booked — our team will call you on +91 ••••• 43210 at 6:30 pm, Tue 28 Oct."
  Reschedule / Cancel / Add to calendar.
- Directly under it: **"Get updates by email (optional)"** — email field (+ name, optional).
  Skipping is fine; everything still works through the in-app notifications.
- Email sending: **Resend** (already integrated; the owner chose Resend over raw SMTP/Nodemailer).
  With an email we send: booking confirmation, reminders (24 h + 1 h), quote ready, payment receipt.
- Navbar shows a **bell** with an unread count from now on. "Log in" (same phone + OTP) when logged out.

### ④ Sales call — offline
- The sales team calls the customer's verified number at the booked time and negotiates.
- After the call they record the outcome in admin (completed / no-show).

### ⑤ Quote — admin
- Admin opens the booking or the lead and fills **one small form**:
  - Plan name (e.g. "12-week coaching")
  - Amount in ₹ (whatever was agreed on the call)
  - Plan length (e.g. 1 / 3 / 6 / 12 months, or a number of days)
  - Optional note
- "Send quote" → it goes to **that customer only**. It must be quick: the most common path is
  Bookings → today's call → Send quote.

### ⑥ Customer sees the quote and pays — `/account`
- The quote appears as a **notification** (bell + inbox) and as a banner on `/account`:
  "Your plan quote is ready · 12-week coaching · ₹12,000 → View & pay". Email too, if given.
- Pay with **Razorpay** (built; needs live keys). Stripe is undecided. The amount always comes
  from the server, never from the browser.
- After payment: "Payment received" notification, quote marked PAID, the plan becomes active.

### ⑦ Active plan — admin `/admin/clients`
- Every paying customer is listed with: **name, client ID, phone, plan, amount paid, paid on,
  valid from, valid until, status** (Active / Expiring soon / Expired).
- Valid from = payment date (default), valid until = from + plan length. **Admin can edit both
  dates** (late start, extension, free extra week) and add notes.
- Renewals = send a new quote; paying it adds a new plan period after the current one.
- The customer's `/account` shows "Your plan: 12-week coaching · active until 20 Jan 2027".

---

## Rules that keep the flow simple
1. One path for everybody: number → OTP → time. Never ask the visitor to choose sign up/log in.
2. Nothing is required before booking except the phone number.
3. Email and name are optional and asked **after** booking, never before.
4. Prices and plans are never public. They only exist as quotes to one customer.
5. Every customer-facing update is an in-app notification first; email is a bonus copy.
6. The admin panel is built for a busy sales person: fewest clicks from "call done" to "quote sent".

## Providers
| Need | Provider | Status |
|---|---|---|
| Phone OTP | MSG91 (owner rejected Twilio as too costly) | mock locally, no live key |
| Email | Resend | mock locally, no live key |
| Payments | Razorpay (Stripe "we will see") | built, no live keys |
| Lead source | ManyChat link with `source/campaign/mc` params | working |

## Data (Prisma)
- `Lead` = the customer account (unique verified phone, optional name/email, `clientCode` like RAHUL-4821).
- `Booking` = the sales call. `Quote` = plan + ₹ (+ plan length) sent to one lead. `Payment` = a Razorpay attempt.
- `Membership` = a paid plan period (lead, quote, plan, ₹, validFrom, validUntil, notes) — powers `/admin/clients`.
- `InboxItem` = in-app notification. `Notification` = email outbox (Resend) with retries.

## Build status (2026-10-22)
| Step | Status |
|---|---|
| ① ② number → OTP → time, no sign-up/log-in choice | built |
| ③ booked → `/account` with "You're booked" + optional email/name | built (saving an email sends the booking confirmation + reminders) |
| ⑤ quote form with plan length | built |
| ⑥ quote in notifications + `/account` banner | built; **quote email not built yet** (in-app only) |
| ⑥ pay online | Razorpay built, needs live keys. Until then admin uses **"Mark paid (UPI / cash)"** on the quote |
| ⑦ `/admin/clients` list + editable dates on the client page | built |
| Renewal reminders before a plan ends | not built |
