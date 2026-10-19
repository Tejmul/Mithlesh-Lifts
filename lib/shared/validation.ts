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

/** Step 1 — phone. */
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
