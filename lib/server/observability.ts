import "server-only";

/**
 * Error-reporting integration point. Wire Sentry (or similar) here: set SENTRY_DSN and call
 * Sentry.captureException(err, { extra: context }). Context must never contain OTPs, passwords,
 * tokens, phone numbers or emails — pass ids only.
 */
export function reportError(err: unknown, context: Record<string, string | number | boolean | undefined> = {}) {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[error] ${message}`, context);
}

/** Structured, PII-free operational log line. */
export function logEvent(event: string, context: Record<string, string | number | boolean | undefined> = {}) {
  if (process.env.NODE_ENV === "test") return;
  console.info(`[event] ${event}`, context);
}
