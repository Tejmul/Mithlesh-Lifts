import "server-only";
// OWNER: Agent C.
import { env } from "../env";
import { reportError } from "../observability";
import { sendViaMock } from "./mock";
import { sendViaResend } from "./resend";

export type EmailMessage = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Sent as Resend's Idempotency-Key so a retry never delivers twice. */
  idempotencyKey: string;
  replyTo?: string;
};

export type EmailResult = { ok: true; providerMessageId?: string } | { ok: false; error: string; retryable: boolean };

/** Sends through EMAIL_PROVIDER (resend | mock). Never throws for provider failures. */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  try {
    const provider = env().EMAIL_PROVIDER;
    if (provider === "resend") return await sendViaResend(msg);
    return sendViaMock(msg);
  } catch (err) {
    reportError(err, { where: "sendEmail" });
    return { ok: false, retryable: true, error: err instanceof Error ? err.message.slice(0, 200) : "send failed" };
  }
}
