import "server-only";
import { z } from "zod";

/**
 * All server configuration, validated once. Secrets never leave the server:
 * nothing here is prefixed NEXT_PUBLIC_.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  /** Public base URL, e.g. https://book.mithileshreddy.com — used in emails and ManyChat links. */
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** 32+ random characters. Signs manage links and hashes session tokens. */
  APP_SECRET: z.string().min(32),

  /** Phone OTP service. Resend does not send SMS — use Twilio Verify or MSG91. */
  PHONE_VERIFY_PROVIDER: z.enum(["twilio_verify", "msg91", "mock"]).default("mock"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  /** Seconds a visitor must wait before requesting another code. */
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(15).max(600).default(45),

  EMAIL_PROVIDER: z.enum(["resend", "mock"]).default("mock"),
  RESEND_API_KEY: z.string().optional(),
  /** e.g. "mithilesh_lifts <calls@mail.yourdomain.com>" — the domain must be verified in Resend. */
  EMAIL_FROM: z.string().default("mithilesh_lifts <calls@example.com>"),
  EMAIL_REPLY_TO: z.string().optional(),

  /** Bearer secret for /api/cron/* (Vercel Cron sends Authorization: Bearer <CRON_SECRET>). */
  CRON_SECRET: z.string().min(16).optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  /** Hook for an error tracker (Sentry etc.). */
  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production") {
    // Phone OTP is parked (sign-in codes go by email, docs/FLOW.md), so PHONE_VERIFY_PROVIDER isn't checked here.
    if (e.EMAIL_PROVIDER === "mock") throw new Error("EMAIL_PROVIDER=mock is not allowed in production");
    if (e.APP_URL.includes("localhost") || /REPLACE/i.test(e.APP_URL)) {
      throw new Error("APP_URL must be the public URL in production");
    }
    // Sign-in codes go by email: without these nobody could log in or book.
    if (e.EMAIL_PROVIDER === "resend" && !e.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required in production");
    if (/@example\.com/i.test(e.EMAIL_FROM)) throw new Error("EMAIL_FROM must be a real sender in production");
  }
  cached = e;
  return e;
}

/** For tests only. */
export function resetEnvCache() {
  cached = undefined;
}

export const isProduction = () => env().NODE_ENV === "production";
