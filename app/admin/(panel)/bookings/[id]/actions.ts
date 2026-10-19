"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/app/admin/_components/types";
import { actionFailure, validationFailure } from "@/lib/server/admin/action-utils";
import { requireAdmin } from "@/lib/server/admin/auth";
import { cancelBooking, rescheduleBooking, setBookingStatus } from "@/lib/server/bookings/service";
import { db } from "@/lib/server/db";
import { logEvent } from "@/lib/server/observability";
import { emailSchema } from "@/lib/shared/validation";

const bookingId = z.string().trim().min(1).max(64);

const notesSchema = z.object({
  bookingId,
  notes: z.string().max(5000, "Keep notes under 5,000 characters."),
});

export async function saveNotesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = notesSchema.safeParse({ bookingId: formData.get("bookingId"), notes: formData.get("notes") ?? "" });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    const notes = parsed.data.notes.trim();
    const { count } = await db.booking.updateMany({
      where: { id: parsed.data.bookingId },
      data: { internalNotes: notes || null },
    });
    if (count === 0) return { error: "Booking not found." };
  } catch (err) {
    return actionFailure(err, "admin.save_notes");
  }
  refresh();
  return { ok: "Notes saved." };
}

const statusSchema = z.object({ bookingId, status: z.enum(["CONFIRMED", "COMPLETED", "NO_SHOW"]) });

export async function setStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = statusSchema.safeParse({ bookingId: formData.get("bookingId"), status: formData.get("status") });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    await setBookingStatus({ bookingId: parsed.data.bookingId, status: parsed.data.status });
    if (parsed.data.status !== "COMPLETED") {
      // A sale only exists for a completed call.
      await db.booking.update({
        where: { id: parsed.data.bookingId },
        data: { convertedAt: null, dealValueInr: null },
      });
    }
    logEvent("admin.booking_status", { adminUserId: admin.id, bookingId: parsed.data.bookingId, status: parsed.data.status });
  } catch (err) {
    return actionFailure(err, "admin.set_status");
  }
  refresh();
  return { ok: "Status updated." };
}

const cancelSchema = z.object({
  bookingId,
  reason: z.string().trim().min(2, "Add a short reason.").max(500, "Keep the reason under 500 characters."),
});

export async function cancelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = cancelSchema.safeParse({ bookingId: formData.get("bookingId"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    await cancelBooking({
      bookingId: parsed.data.bookingId,
      reason: parsed.data.reason,
      actor: { by: "admin", adminUserId: admin.id },
    });
  } catch (err) {
    return actionFailure(err, "admin.cancel");
  }
  refresh();
  return { ok: "Booking cancelled. The customer will be emailed." };
}

const rescheduleSchema = z.object({
  bookingId,
  start: z.iso.datetime({ offset: true, message: "Pick a new time." }),
});

export async function rescheduleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = rescheduleSchema.safeParse({ bookingId: formData.get("bookingId"), start: formData.get("start") ?? "" });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    await rescheduleBooking({
      bookingId: parsed.data.bookingId,
      start: new Date(parsed.data.start),
      actor: { by: "admin", adminUserId: admin.id },
    });
  } catch (err) {
    return actionFailure(err, "admin.reschedule");
  }
  refresh();
  return { ok: "Booking moved. The customer will be emailed." };
}

const clientSchema = z.object({
  bookingId,
  dealValueInr: z.coerce
    .number({ message: "Enter the deal value in rupees." })
    .int("Use whole rupees (no paise).")
    .positive("Deal value must be more than ₹0.")
    .max(100_000_000, "That deal value looks too large."),
});

/** Sales outcome: the lead became a paying client. Sets COMPLETED + convertedAt/dealValueInr. */
export async function markClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = clientSchema.safeParse({
    bookingId: formData.get("bookingId"),
    dealValueInr: String(formData.get("dealValueInr") ?? "").replace(/[,\s₹]/g, ""),
  });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    const current = await db.booking.findUnique({
      where: { id: parsed.data.bookingId },
      select: { status: true, convertedAt: true },
    });
    if (!current) return { error: "Booking not found." };
    if (current.status === "CANCELLED") return { error: "This booking was cancelled." };
    if (current.status !== "COMPLETED") {
      await setBookingStatus({ bookingId: parsed.data.bookingId, status: "COMPLETED" });
    }
    await db.booking.update({
      where: { id: parsed.data.bookingId },
      data: { convertedAt: current.convertedAt ?? new Date(), dealValueInr: parsed.data.dealValueInr },
    });
    logEvent("admin.booking_converted", { adminUserId: admin.id, bookingId: parsed.data.bookingId });
  } catch (err) {
    return actionFailure(err, "admin.mark_client");
  }
  refresh();
  return { ok: "Marked as client." };
}

/** Sales outcome: call happened, no sale. COMPLETED with no deal (also undoes a conversion). */
export async function markNotConvertedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ bookingId }).safeParse({ bookingId: formData.get("bookingId") });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    const current = await db.booking.findUnique({ where: { id: parsed.data.bookingId }, select: { status: true } });
    if (!current) return { error: "Booking not found." };
    if (current.status === "CANCELLED") return { error: "This booking was cancelled." };
    if (current.status !== "COMPLETED") {
      await setBookingStatus({ bookingId: parsed.data.bookingId, status: "COMPLETED" });
    }
    await db.booking.update({
      where: { id: parsed.data.bookingId },
      data: { convertedAt: null, dealValueInr: null },
    });
    logEvent("admin.booking_not_converted", { adminUserId: admin.id, bookingId: parsed.data.bookingId });
  } catch (err) {
    return actionFailure(err, "admin.mark_not_converted");
  }
  refresh();
  return { ok: "Marked as not converted." };
}

const leadSchema = z.object({
  bookingId,
  fullName: z
    .string()
    .trim()
    .max(80, "Keep the name under 80 characters.")
    .refine((v) => v === "" || v.length >= 2, "Enter at least 2 characters, or leave it empty."),
  email: z.union([z.literal(""), emailSchema]),
});

/** Sales team adds/edits the lead's name and email (the customer flow only collects the phone). */
export async function saveLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = leadSchema.safeParse({
    bookingId: formData.get("bookingId"),
    fullName: formData.get("fullName") ?? "",
    email: String(formData.get("email") ?? "").trim(),
  });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    const booking = await db.booking.findUnique({ where: { id: parsed.data.bookingId }, select: { leadId: true } });
    if (!booking) return { error: "Booking not found." };
    await db.lead.update({
      where: { id: booking.leadId },
      data: { fullName: parsed.data.fullName || null, email: parsed.data.email || null },
    });
    logEvent("admin.lead_updated", { adminUserId: admin.id, leadId: booking.leadId });
  } catch (err) {
    return actionFailure(err, "admin.save_lead");
  }
  refresh();
  return { ok: "Lead details saved." };
}
