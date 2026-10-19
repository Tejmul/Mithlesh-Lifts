// Public API contract between the booking UI and the server. Both sides import these types.
// Flow: start → phone/send → phone/verify → (availability) → confirm. Name/email are optional.
// Errors: HTTP 4xx/5xx with body ApiErrorBody. Timestamps: ISO 8601 UTC strings.

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SESSION_EXPIRED"
  | "PHONE_NOT_VERIFIED"
  | "OTP_INVALID" // wrong or expired — deliberately not distinguished
  | "OTP_COOLDOWN"
  | "OTP_SEND_FAILED"
  | "SLOT_TAKEN"
  | "SLOT_UNAVAILABLE"
  | "TOO_LATE_TO_CHANGE"
  | "ALREADY_BOOKED"
  | "INTERNAL";

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string> };
};

// ---------------------------------------------------------------- session

/** Snapshot of the visitor's progress. Returned by start / phone/verify / contact. */
export type BookingSessionView = {
  /** Number the last code was sent to (E.164), if any. */
  pendingPhoneE164: string | null;
  phoneE164: string | null;
  phoneVerified: boolean;
  fullName: string | null;
  email: string | null;
  callMinutes: number;
  coachTimeZone: string;
  /** Set once this session has produced a booking — the UI should show the confirmation. */
  bookingReference: string | null;
  /** After verification: this number's next confirmed call (returning visitor → offer reschedule/cancel). */
  upcomingBooking: BookingView | null;
  /** Set once the visitor is logged in (phone verified → account exists). */
  account: AccountSummary | null;
};

export type AccountSummary = { clientCode: string; fullName: string | null; phoneE164: string };
export type SessionResponse = { session: BookingSessionView };

/**
 * POST /api/booking/start — creates/resumes the session (httpOnly cookie).
 * ManyChat link: /book?source=manychat&campaign=fit_reel&mc=<subscriber id>. No PII in URLs.
 */
export type StartSessionRequest = { source?: string; campaign?: string; mc?: string };

/**
 * POST /api/booking/phone/send — step 1. 429 RATE_LIMITED / OTP_COOLDOWN, 502 OTP_SEND_FAILED.
 * mode "signup" (name + phone) or "login" (phone only). The server never reveals whether an
 * account exists before the OTP is verified.
 */
export type SendCodeRequest = { country: string; phone: string; fullName?: string; mode?: "signup" | "login" };
export type SendCodeResponse = { sentTo: string; resendAvailableAt: string };

/**
 * POST /api/booking/phone/verify → SessionResponse. 400 OTP_INVALID.
 * On success the phone is verified. If an account exists (or a name was given at signup) the
 * account is created/loaded, session.account is set and the customer cookie is issued.
 * If this number has no account and no name is known, session.phoneVerified = true but
 * session.account = null → the UI asks for the name and calls POST /api/booking/account.
 */
export type VerifyCodeRequest = { code: string };

/** POST /api/booking/account { fullName } — finish creating the account after verification → SessionResponse. 403 PHONE_NOT_VERIFIED. */
export type CreateAccountRequest = { fullName: string };

/** PUT /api/booking/contact — optional (not used by the current flow) → SessionResponse. */
export type SaveContactRequest = { fullName: string; email: string; marketingConsent?: boolean };

// ---------------------------------------------------------------- availability

/** GET /api/availability?from=ISO&to=ISO (optional; defaults to the full booking horizon). */
export type AvailabilityResponse = {
  coachTimeZone: string;
  callMinutes: number;
  windowStart: string;
  windowEnd: string;
  slots: { start: string; end: string }[];
};

// ---------------------------------------------------------------- confirm

/** POST /api/booking/confirm. idempotencyKey: one UUID per review screen (double-clicks are safe). */
export type ConfirmBookingRequest = { start: string; timeZone: string; idempotencyKey: string };

export type BookingView = {
  reference: string;
  start: string;
  end: string;
  customerTimeZone: string;
  status: "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  meetingUrl: string | null;
  fullName: string | null;
  email: string | null;
  phoneE164: string;
  /** Absolute /booking/manage/[token] URL; null once the change cutoff has passed or not active. */
  manageUrl: string | null;
};
export type BookingResponse = { booking: BookingView };

// ---------------------------------------------------------------- manage (token-authenticated)

/** POST /api/booking/manage/cancel → BookingResponse */
export type CancelBookingRequest = { token: string; reason?: string };
/** POST /api/booking/manage/reschedule → BookingResponse (fresh manageUrl; old link stops working) */
export type RescheduleBookingRequest = { token: string; start: string; timeZone: string };

// ---------------------------------------------------------------- customer account (cookie: css_customer)

/** GET /api/account → 401 UNAUTHORIZED when logged out. */
export type AccountResponse = {
  account: AccountSummary;
  upcomingBooking: BookingView | null;
  unreadCount: number;
};

export type InboxItemView = {
  id: string;
  kind: "booking_confirmed" | "booking_rescheduled" | "booking_cancelled" | "quote_sent" | "payment_received";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** Where tapping the notification goes, e.g. "/account/quotes/<id>" or the booking manage URL. */
  href: string | null;
};
/** GET /api/account/inbox */
export type InboxResponse = { items: InboxItemView[]; unreadCount: number };
/** POST /api/account/inbox/read { ids?: string[] } — omit ids to mark all read → InboxResponse */
export type MarkReadRequest = { ids?: string[] };

export type QuoteView = {
  id: string;
  reference: string;
  planName: string;
  amountInr: number;
  note: string | null;
  status: "SENT" | "PAID" | "CANCELLED";
  createdAt: string;
  paidAt: string | null;
  /** False until a payment provider is configured — UI shows "Payment opens soon". */
  canPay: boolean;
};
/** GET /api/account/quotes → { quotes } ; GET /api/account/quotes/[id] → { quote } (404 if not the customer's) */
export type QuotesResponse = { quotes: QuoteView[] };
export type QuoteResponse = { quote: QuoteView };

/** POST /api/account/quotes/[id]/checkout → opens Razorpay Checkout on the client. 409 if already paid. */
export type CheckoutResponse = {
  provider: "razorpay";
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: "INR";
  name: string; // brand shown in the checkout
  description: string; // plan name
  prefill: { name?: string; contact?: string };
};
/** POST /api/payments/razorpay/verify → QuoteResponse (status PAID) */
export type VerifyPaymentRequest = {
  quoteId: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

/** POST /api/account/logout → 204 */
