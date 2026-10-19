import "server-only";
import { env } from "../env";
import type { EmailMessage, EmailResult } from "./index";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/** Sends one email through Resend's REST API. Never throws. Error strings never contain recipients. */
export async function sendViaResend(msg: EmailMessage): Promise<EmailResult> {
  const e = env();
  if (!e.RESEND_API_KEY) return { ok: false, retryable: false, error: "RESEND_API_KEY not configured" };

  const replyTo = msg.replyTo ?? e.EMAIL_REPLY_TO;
  const body = {
    from: e.EMAIL_FROM,
    to: Array.isArray(msg.to) ? msg.to : [msg.to],
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(replyTo ? { reply_to: replyTo } : {}),
  };

  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${e.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": msg.idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    return { ok: false, retryable: true, error: `Resend network error (${name})` };
  }

  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, providerMessageId: typeof data.id === "string" ? data.id : undefined };
  }

  // Resend error bodies: { statusCode, name, message }. Keep only the machine-readable name.
  const data = (await res.json().catch(() => ({}))) as { name?: string };
  const detail = typeof data.name === "string" ? ` ${data.name.slice(0, 60)}` : "";
  // 409 concurrent_idempotent_requests: the same key is still in flight at Resend — try again later.
  const retryable =
    res.status === 429 || res.status >= 500 || (res.status === 409 && data.name === "concurrent_idempotent_requests");
  return { ok: false, retryable, error: `Resend HTTP ${res.status}${detail}` };
}
