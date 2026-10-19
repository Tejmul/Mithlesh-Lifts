import "server-only";
// MSG91 OTP v5 (https://docs.msg91.com/otp). MSG91 generates, sends and checks the code.
// NOTE: sending SMS to Indian numbers requires a DLT-approved OTP template; set its id in
// MSG91_OTP_TEMPLATE_ID. Error strings never include the phone number or code.
import { env } from "../env";
import type { CheckResult, StartResult } from "./index";

const BASE = "https://control.msg91.com/api/v5/otp";
const NOT_CONFIGURED = "MSG91 OTP is not configured (MSG91_AUTH_KEY / MSG91_OTP_TEMPLATE_ID)";

/** MSG91 wants the number as digits with country code and no "+". */
const digits = (e164: string) => e164.replace(/\D/g, "");

type Msg91Body = { type?: string; message?: string };

async function readBody(res: Response): Promise<Msg91Body> {
  return ((await res.json().catch(() => null)) as Msg91Body | null) ?? {};
}

/** Messages MSG91 returns for a wrong, expired, used or exhausted OTP (as opposed to config/account errors). */
const CODE_REJECTED = /(otp|code).*(not match|invalid|incorrect|expired?)|expired|already verified|max(imum)? limit|no request found|retry count/i;
const ACCOUNT_ERROR = /auth ?key|template|ip ?not|blocked|balance/i;

export async function start(phoneE164: string): Promise<StartResult> {
  const e = env();
  if (!e.MSG91_AUTH_KEY || !e.MSG91_OTP_TEMPLATE_ID) return { ok: false, error: NOT_CONFIGURED };
  const url = `${BASE}?template_id=${encodeURIComponent(e.MSG91_OTP_TEMPLATE_ID)}&mobile=${digits(phoneE164)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authkey: e.MSG91_AUTH_KEY, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  const body = await readBody(res);
  if (res.ok && body.type === "success") return { ok: true };
  return { ok: false, error: `MSG91 send failed (HTTP ${res.status}): ${body.message ?? "unknown error"}` };
}

export async function check(phoneE164: string, code: string): Promise<CheckResult> {
  const e = env();
  if (!e.MSG91_AUTH_KEY) return { ok: false, error: NOT_CONFIGURED };
  const url = `${BASE}/verify?otp=${encodeURIComponent(code)}&mobile=${digits(phoneE164)}`;
  const res = await fetch(url, { method: "GET", headers: { authkey: e.MSG91_AUTH_KEY }, cache: "no-store" });
  const body = await readBody(res);
  if (body.type === "success") return { ok: true, approved: true };
  const message = body.message ?? "";
  if (body.type === "error" && CODE_REJECTED.test(message) && !ACCOUNT_ERROR.test(message)) {
    return { ok: true, approved: false };
  }
  return { ok: false, error: `MSG91 verify failed (HTTP ${res.status}): ${message || "unknown error"}` };
}
