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
};
export type SessionResponse = { session: BookingSessionView };

/**
 * POST /api/booking/start — creates/resumes the session (httpOnly cookie).
 * ManyChat link: /book?source=manychat&campaign=fit_reel&mc=<subscriber id>. No PII in URLs.
 */
export type StartSessionRequest = { source?: string; campaign?: string; mc?: string };

/** POST /api/booking/phone/send — step 1. 429 RATE_LIMITED / OTP_COOLDOWN, 502 OTP_SEND_FAILED. */
export type SendCodeRequest = { country: string; phone: string };
export type SendCodeResponse = { sentTo: string; resendAvailableAt: string };

/** POST /api/booking/phone/verify → SessionResponse. 400 OTP_INVALID. */
export type VerifyCodeRequest = { code: string };

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
