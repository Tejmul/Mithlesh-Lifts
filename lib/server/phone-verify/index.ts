import "server-only";
// OWNER: Agent A.
// Providers generate, send and check the code themselves (Twilio Verify / MSG91 OTP),
// so we never store OTPs. The mock provider is for development/tests only.
import { env } from "../env";
import * as msg91 from "./msg91";
import * as mock from "./mock";
import * as twilio from "./twilio";

export type StartResult = { ok: true } | { ok: false; error: string };
export type CheckResult = { ok: true; approved: boolean } | { ok: false; error: string };

type Provider = {
  start(phoneE164: string): Promise<StartResult>;
  check(phoneE164: string, code: string): Promise<CheckResult>;
};

function provider(): Provider {
  switch (env().PHONE_VERIFY_PROVIDER) {
    case "twilio_verify":
      return twilio;
    case "msg91":
      return msg91;
    case "mock":
      return mock;
  }
}

/** Sends a code to an E.164 number via PHONE_VERIFY_PROVIDER. */
export async function startPhoneVerification(phoneE164: string): Promise<StartResult> {
  try {
    return await provider().start(phoneE164);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Phone verification failed" };
  }
}

/** Checks a code. approved=false for wrong/expired codes; ok=false only for provider errors. */
export async function checkPhoneVerification(phoneE164: string, code: string): Promise<CheckResult> {
  try {
    return await provider().check(phoneE164, code);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Phone verification failed" };
  }
}
