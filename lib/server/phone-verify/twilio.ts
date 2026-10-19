import "server-only";
// Twilio Verify (https://www.twilio.com/docs/verify/api). Twilio generates, sends and checks the code.
// Plain REST over fetch — no SDK. Error strings never include the phone number or code.
import { env } from "../env";
import type { CheckResult, StartResult } from "./index";

function config() {
  const e = env();
  if (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN || !e.TWILIO_VERIFY_SERVICE_SID) return null;
  return {
    base: `https://verify.twilio.com/v2/Services/${encodeURIComponent(e.TWILIO_VERIFY_SERVICE_SID)}`,
    auth: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
  };
}

const NOT_CONFIGURED = "Twilio Verify is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID)";

async function post(url: string, auth: string, form: Record<string, string>) {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  });
}

async function twilioErrorCode(res: Response): Promise<number | undefined> {
  const body = (await res.json().catch(() => null)) as { code?: number } | null;
  return body?.code;
}

export async function start(phoneE164: string): Promise<StartResult> {
  const c = config();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const res = await post(`${c.base}/Verifications`, c.auth, { To: phoneE164, Channel: "sms" });
  if (res.ok) return { ok: true };
  const code = await twilioErrorCode(res);
  return { ok: false, error: `Twilio Verify send failed (HTTP ${res.status}${code ? `, code ${code}` : ""})` };
}

export async function check(phoneE164: string, code: string): Promise<CheckResult> {
  const c = config();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const res = await post(`${c.base}/VerificationCheck`, c.auth, { To: phoneE164, Code: code });
  // 404: no pending verification (expired, already approved, or never sent).
  if (res.status === 404) return { ok: true, approved: false };
  if (!res.ok) {
    const errCode = await twilioErrorCode(res);
    // 60202: max check attempts reached — the verification is dead; treat like a wrong code.
    if (errCode === 60202) return { ok: true, approved: false };
    return { ok: false, error: `Twilio Verify check failed (HTTP ${res.status}${errCode ? `, code ${errCode}` : ""})` };
  }
  const body = (await res.json().catch(() => null)) as { status?: string } | null;
  return { ok: true, approved: body?.status === "approved" };
}
