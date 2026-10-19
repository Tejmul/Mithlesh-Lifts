import "server-only";
import { DateTime } from "luxon";

/**
 * Transactional email templates. Each returns { subject, html, text }.
 * HTML uses inline CSS + table layout so it renders in Gmail/Outlook/Apple Mail and on phones.
 * Every interpolated value goes through esc(). No marketing content.
 */

export type RenderedEmail = { subject: string; html: string; text: string };

export type CustomerEmailInput = {
  name: string;
  reference: string;
  start: Date;
  callMinutes: number;
  customerTimeZone: string;
  meetingUrl: string | null;
  manageUrl: string | null;
};

export type ReminderEmailInput = CustomerEmailInput & { offsetMinutes: number };

export type TeamEmailInput = {
  name: string;
  reference: string;
  start: Date;
  callMinutes: number;
  customerTimeZone: string;
  coachTimeZone: string;
  meetingUrl: string | null;
  email: string | null;
  phone: string;
  source: string | null;
  campaign: string | null;
};

export type TeamChangeEmailInput = TeamEmailInput & { change: "rescheduled" | "cancelled" };

const BRAND = "mithilesh_lifts · Coach Scale Systems";
const COLORS = { band: "#111214", gold: "#E8A33D", text: "#1d1f23", muted: "#5f6368", line: "#e6e6e6", page: "#f4f4f2" };

// ---------------------------------------------------------------- helpers

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) URLs are rendered as links; anything else is dropped. */
function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function zoneAbbreviation(dt: DateTime): string {
  // Different locales know different abbreviations (en-IN → IST, en-US → EDT, en-GB → BST).
  const names = ["en-US", "en-IN", "en-GB"].map((l) => dt.setLocale(l).offsetNameShort ?? "");
  return names.find((n) => n && !/^(GMT|UTC)[+-]/.test(n)) ?? names[0] ?? "";
}

/** e.g. "Tuesday, 21 October 2026 · 7:30 PM IST (Asia/Kolkata)". Falls back to UTC for an invalid zone. */
export function formatWhen(start: Date, timeZone: string): string {
  let dt = DateTime.fromJSDate(start).setZone(timeZone);
  let zone = timeZone;
  if (!dt.isValid) {
    dt = DateTime.fromJSDate(start).setZone("UTC");
    zone = "UTC";
  }
  const base = dt.setLocale("en-US").toFormat("cccc, d LLLL yyyy · h:mm a");
  const abbr = zoneAbbreviation(dt);
  return abbr && abbr !== zone ? `${base} ${abbr} (${zone})` : `${base} (${zone})`;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

type Row = [label: string, value: string, href?: string | null];

function rowsHtml(rows: Row[]) {
  return rows
    .map(
      ([label, value, href]) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid ${COLORS.line};color:${COLORS.muted};font-size:13px;width:34%;vertical-align:top;">${esc(label)}</td>
<td style="padding:10px 0;border-bottom:1px solid ${COLORS.line};color:${COLORS.text};font-size:15px;vertical-align:top;word-break:break-word;">${
        href ? `<a href="${esc(href)}" style="color:${COLORS.text};text-decoration:underline;">${esc(value)}</a>` : esc(value)
      }</td>
</tr>`,
    )
    .join("");
}

function button(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;"><tr>
<td style="background:${COLORS.gold};border-radius:6px;"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;color:${COLORS.band};font-weight:700;font-size:15px;text-decoration:none;">${esc(label)}</a></td>
</tr></table>`;
}

function layout(opts: { preheader: string; heading: string; intro: string[]; rows: Row[]; cta?: { label: string; href: string } | null; footer: string[] }) {
  const paragraphs = opts.intro
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${COLORS.text};">${esc(p)}</p>`)
    .join("");
  const footer = opts.footer
    .map((p) => `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:${COLORS.muted};">${esc(p)}</p>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:${COLORS.band};padding:20px 28px;border-bottom:3px solid ${COLORS.gold};">
<span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.02em;">${esc(BRAND)}</span>
</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${COLORS.text};">${esc(opts.heading)}</h1>
${paragraphs}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${rowsHtml(opts.rows)}</table>
${opts.cta ? button(opts.cta.label, opts.cta.href) : ""}
<div style="margin-top:24px;">${footer}</div>
</td></tr>
<tr><td style="padding:16px 28px;background:#fafaf8;border-top:1px solid ${COLORS.line};font-size:12px;color:${COLORS.muted};">${esc(BRAND)}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function textBody(opts: { heading: string; intro: string[]; rows: Row[]; extra?: string[]; footer: string[] }) {
  const lines = [opts.heading, "", ...opts.intro.flatMap((p) => [p, ""])];
  for (const [label, value, href] of opts.rows) lines.push(`${label}: ${value}${href && href !== value ? ` (${href})` : ""}`);
  if (opts.extra?.length) lines.push("", ...opts.extra);
  lines.push("", ...opts.footer, "", "—", BRAND);
  return lines.join("\n");
}

function customerRows(i: CustomerEmailInput): Row[] {
  const meeting = safeUrl(i.meetingUrl);
  return [
    ["When", formatWhen(i.start, i.customerTimeZone)],
    ["Length", `${i.callMinutes} minutes`],
    ["Reference", i.reference],
    meeting ? ["Join link", meeting, meeting] : ["How", "Our sales team will call you on your verified number at this time."],
  ];
}

function manageFooter(manageUrl: string | null): string[] {
  return manageUrl
    ? ["Need a different time? Use the button above to reschedule or cancel."]
    : ["Need to change this booking? Message us on Instagram and our team will help."];
}

function render(opts: {
  subject: string;
  preheader: string;
  heading: string;
  intro: string[];
  rows: Row[];
  cta?: { label: string; href: string } | null;
  footer: string[];
}): RenderedEmail {
  const extra = opts.cta ? [`${opts.cta.label}: ${opts.cta.href}`] : [];
  return {
    subject: opts.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
    html: layout(opts),
    text: textBody({ heading: opts.heading, intro: opts.intro, rows: opts.rows, extra, footer: opts.footer }),
  };
}

// ---------------------------------------------------------------- customer emails

export function bookingConfirmed(i: CustomerEmailInput): RenderedEmail {
  const manage = safeUrl(i.manageUrl);
  return render({
    subject: `Your call with Mithilesh is booked — ${i.reference}`,
    preheader: formatWhen(i.start, i.customerTimeZone),
    heading: "Your call is booked",
    intro: [`Hi ${firstName(i.name)},`, "Thanks for booking a call. Our sales team will call you at the time below."],
    rows: customerRows(i),
    cta: manage ? { label: "Reschedule or cancel", href: manage } : null,
    footer: manageFooter(manage),
  });
}

export function bookingRescheduled(i: CustomerEmailInput): RenderedEmail {
  const manage = safeUrl(i.manageUrl);
  return render({
    subject: `Your call has been moved — ${i.reference}`,
    preheader: `New time: ${formatWhen(i.start, i.customerTimeZone)}`,
    heading: "Your call has a new time",
    intro: [`Hi ${firstName(i.name)},`, "Your call has been rescheduled. Earlier links to manage this booking no longer work."],
    rows: customerRows(i),
    cta: manage ? { label: "Reschedule or cancel", href: manage } : null,
    footer: manageFooter(manage),
  });
}

export function bookingCancelled(i: CustomerEmailInput): RenderedEmail {
  return render({
    subject: `Your call has been cancelled — ${i.reference}`,
    preheader: "Your booking has been cancelled.",
    heading: "Your call has been cancelled",
    intro: [`Hi ${firstName(i.name)},`, "Your call has been cancelled."],
    rows: [
      ["Was scheduled for", formatWhen(i.start, i.customerTimeZone)],
      ["Reference", i.reference],
    ],
    cta: null,
    footer: ["If this was a mistake or you'd like a new time, reply to this email."],
  });
}

export function reminderWording(offsetMinutes: number): string {
  if (offsetMinutes % 60 === 0) {
    const h = offsetMinutes / 60;
    return h === 1 ? "in 1 hour" : `in ${h} hours`;
  }
  return `in ${offsetMinutes} minutes`;
}

export function reminder(i: ReminderEmailInput): RenderedEmail {
  const manage = safeUrl(i.manageUrl);
  const when = reminderWording(i.offsetMinutes);
  const meeting = safeUrl(i.meetingUrl);
  return render({
    subject: `Reminder: your call with Mithilesh is ${when}`,
    preheader: formatWhen(i.start, i.customerTimeZone),
    heading: `Your call is ${when}`,
    intro: [`Hi ${firstName(i.name)},`, `A quick reminder that our sales team will call you ${when}.`],
    rows: customerRows(i),
    cta: meeting ? { label: "Join the call", href: meeting } : manage ? { label: "Reschedule or cancel", href: manage } : null,
    footer:
      meeting && manage
        ? [`Can't make it? Reschedule or cancel here: ${manage}`]
        : manageFooter(manage),
  });
}

// ---------------------------------------------------------------- team emails

function teamRows(i: TeamEmailInput): Row[] {
  const rows: Row[] = [
    ["When (coach)", formatWhen(i.start, i.coachTimeZone)],
    ["Customer's zone", i.customerTimeZone],
    ["Length", `${i.callMinutes} minutes`],
    ["Name", i.name || "Not given yet"],
    ["Email", i.email || "Not given yet"],
    ["Phone", i.phone],
    ["Reference", i.reference],
    ["Source", i.source || "—"],
    ["Campaign", i.campaign || "—"],
  ];
  const meeting = safeUrl(i.meetingUrl);
  if (meeting) rows.push(["Join link", meeting, meeting]);
  return rows;
}

export function teamNewBooking(i: TeamEmailInput): RenderedEmail {
  return render({
    subject: `New call booked: ${i.name || i.phone} — ${formatWhen(i.start, i.coachTimeZone)}`,
    preheader: `${i.reference} · ${i.name || i.phone}`,
    heading: "New call booked",
    intro: [`${i.name || i.phone} booked a ${i.callMinutes}-minute call.`],
    rows: teamRows(i),
    footer: ["Internal notification."],
  });
}

export function teamBookingChanged(i: TeamChangeEmailInput): RenderedEmail {
  const verb = i.change === "cancelled" ? "cancelled" : "rescheduled";
  return render({
    subject: `Call ${verb}: ${i.name || i.phone} — ${i.reference}`,
    preheader: `${i.reference} · ${i.name || i.phone}`,
    heading: i.change === "cancelled" ? "Call cancelled" : "Call rescheduled",
    intro: [
      i.change === "cancelled"
        ? `The call with ${i.name} has been cancelled.`
        : `The call with ${i.name} has been moved to a new time.`,
    ],
    rows: teamRows(i),
    footer: ["Internal notification."],
  });
}
