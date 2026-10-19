"use server";

import { refresh } from "next/cache";
import { DateTime } from "luxon";
import { z } from "zod";
import type { ActionState } from "@/app/admin/_components/types";
import { actionFailure, validationFailure } from "@/lib/server/admin/action-utils";
import { requireAdmin } from "@/lib/server/admin/auth";
import { validateWindows, windowsSchema } from "@/lib/server/admin/hours";
import { db } from "@/lib/server/db";
import { logEvent } from "@/lib/server/observability";
import { timeZoneSchema } from "@/lib/shared/validation";

export async function saveWeeklyHoursAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("windows") ?? "[]"));
  } catch {
    return { error: "Couldn't read the hours. Reload and try again." };
  }
  const parsed = windowsSchema.safeParse(raw);
  if (!parsed.success) return { error: "Every window needs a start and end time (HH:MM)." };
  const checked = validateWindows(parsed.data);
  if (!checked.ok) return { error: checked.error };
  try {
    await db.$transaction([db.weeklyHours.deleteMany({}), db.weeklyHours.createMany({ data: checked.windows })]);
    logEvent("admin.weekly_hours_saved", { adminUserId: admin.id, windows: checked.windows.length });
  } catch (err) {
    return actionFailure(err, "admin.weekly_hours");
  }
  refresh();
  return { ok: "Weekly hours saved." };
}

const int = (min: number, max: number, label: string) =>
  z.coerce
    .number({ message: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);

const rulesSchema = z.object({
  callMinutes: int(10, 240, "Call length"),
  bufferMinutes: int(0, 240, "Buffer"),
  slotIntervalMinutes: int(5, 240, "Slot interval"),
  minNoticeMinutes: int(0, 60 * 24 * 14, "Minimum notice"),
  maxAdvanceDays: int(1, 365, "Max days ahead"),
  manageCutoffMinutes: int(0, 60 * 24 * 14, "Reschedule cutoff"),
  coachTimeZone: timeZoneSchema,
});

export async function saveRulesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = rulesSchema.safeParse(Object.fromEntries(Object.keys(rulesSchema.shape).map((k) => [k, formData.get(k)])));
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    await db.settings.upsert({ where: { id: 1 }, update: parsed.data, create: { id: 1, ...parsed.data } });
    logEvent("admin.scheduling_rules_saved", { adminUserId: admin.id });
  } catch (err) {
    return actionFailure(err, "admin.rules");
  }
  refresh();
  return { ok: "Booking rules saved." };
}

const dayOffSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
    .refine((d) => DateTime.fromISO(d).isValid, "Pick a valid date."),
  reason: z.string().trim().max(200, "Keep the reason under 200 characters."),
});

export async function addDayOffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = dayOffSchema.safeParse({ date: formData.get("date") ?? "", reason: formData.get("reason") ?? "" });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    await db.dayOff.upsert({
      where: { date: parsed.data.date },
      update: { reason: parsed.data.reason || null },
      create: { date: parsed.data.date, reason: parsed.data.reason || null },
    });
  } catch (err) {
    return actionFailure(err, "admin.day_off_add");
  }
  refresh();
  return { ok: `Day off added: ${parsed.data.date}. Existing bookings that day are not cancelled.` };
}

export async function removeDayOffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z.object({ id: z.string().min(1).max(64) }).safeParse({ id: formData.get("id") });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    await db.dayOff.deleteMany({ where: { id: parsed.data.id } });
  } catch (err) {
    return actionFailure(err, "admin.day_off_remove");
  }
  refresh();
  return { ok: "Removed." };
}
