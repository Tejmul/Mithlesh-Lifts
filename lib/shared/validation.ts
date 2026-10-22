// Validation shared by the browser (instant feedback) and the server (authoritative).
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { z } from "zod";

/** Normalises a national number + ISO country into E.164, or null if it isn't a valid number. */
export function normalizePhone(country: string, phone: string): string | null {
  const parsed = parsePhoneNumberFromString(phone.trim(), country.toUpperCase() as CountryCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** "+9198••••210" — shows where a code went without exposing the full number. */
export function maskPhone(e164: string) {
  if (e164.length < 8) return e164;
  return `${e164.slice(0, 5)}••••${e164.slice(-3)}`;
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email is too long.")
  .pipe(z.email("Enter a valid email address."));

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Enter your name.")
  .max(80, "Keep your name under 80 characters.");

/** "ra•••@gmail.com" — shows where a code went without exposing the full address. */
export function maskEmail(email: string) {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(4, user.length - 2)))}@${domain}`;
}

/**
 * Step 1 (docs/FLOW.md): name + email + phone, code sent by email. "Log in" sends only the email,
 * so name and phone are optional here; mode "book" requires them.
 */
export const sendEmailCodeSchema = z
  .object({
    mode: z.enum(["book", "login"]).default("book"),
    fullName: z.string().trim().max(80, "Keep your name under 80 characters.").optional(),
    email: emailSchema,
    country: z.string().length(2, "Choose your country code.").optional(),
    phone: z.string().trim().max(20, "That number is too long.").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "book" && (v.fullName ?? "").length < 2) {
      ctx.addIssue({ code: "custom", path: ["fullName"], message: "Enter your name." });
    }
    if (v.mode === "book" && !v.phone) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter your mobile number." });
    } else if (v.phone && !normalizePhone(v.country ?? "IN", v.phone)) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid mobile number for the selected country." });
    }
  });

/** After a "Log in" with a new email: the details the booking needs. */
export const detailsSchema = z
  .object({
    fullName: fullNameSchema,
    country: z.string().length(2, "Choose your country code."),
    phone: z.string().trim().min(4, "Enter your mobile number.").max(20, "That number is too long."),
  })
  .superRefine((v, ctx) => {
    if (!normalizePhone(v.country, v.phone)) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid mobile number for the selected country." });
    }
  });

/** Mobile number only (kept for SMS OTP providers, e.g. MSG91, if phone codes come back). */
export const sendCodeSchema = z
  .object({
    country: z.string().length(2, "Choose your country code."),
    phone: z.string().trim().min(4, "Enter your mobile number.").max(20, "That number is too long."),
  })
  .superRefine((v, ctx) => {
    if (!normalizePhone(v.country, v.phone)) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid mobile number for the selected country." });
    }
  });

export const verifyCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{4,8}$/, "Enter the code from the SMS."),
});

/** /account → name change only (the email is the account; see updateProfile). */
export const profileSchema = z.object({
  fullName: z.union([fullNameSchema, z.literal("").transform(() => undefined)]).optional(),
});

/** Admin → send a quote to a client. */
export const quoteSchema = z.object({
  planName: z.string().trim().min(2, "Enter the plan name.").max(80),
  amountInr: z.coerce.number().int("Whole rupees only.").min(1, "Enter an amount.").max(10_000_000),
  durationCount: z.coerce.number().int("Whole numbers only.").min(1, "Enter the plan length.").max(1000),
  durationUnit: z.enum(["DAY", "WEEK", "MONTH"], "Choose days, weeks or months."),
  note: z.string().trim().max(1000).optional(),
});

/** Step 2 — contact. */
export const contactSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(80, "Keep your name under 80 characters."),
  email: emailSchema,
  marketingConsent: z.boolean().optional().default(false),
});

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().max(64).refine(isValidTimeZone, "Choose a valid time zone.");
export const isoDateTimeSchema = z.iso.datetime({ offset: true, message: "Choose a valid time." });

/** Tracking params from the ManyChat link. Plain labels only — never trusted for anything else. */
export const trackingSchema = z.object({
  source: z.string().trim().max(40).regex(/^[\w.-]*$/).optional(),
  campaign: z.string().trim().max(80).regex(/^[\w.-]*$/).optional(),
  mc: z.string().trim().max(40).regex(/^\d*$/).optional(),
});
