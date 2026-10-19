import { describe, expect, it } from "vitest";
import {
  bookingCancelled,
  bookingConfirmed,
  bookingRescheduled,
  esc,
  formatWhen,
  reminder,
  reminderWording,
  teamBookingChanged,
  teamNewBooking,
} from "@/lib/server/email/templates";

const start = new Date("2026-10-21T14:00:00Z");
const base = {
  name: "<script>alert(1)</script> Rao",
  reference: "CSS-7K3P9Q",
  start,
  callMinutes: 30,
  customerTimeZone: "Asia/Kolkata",
  meetingUrl: "https://meet.example.com/abc?x=1&y=2",
  manageUrl: "http://localhost:3000/booking/manage/tok",
};
const team = {
  ...base,
  coachTimeZone: "Asia/Kolkata",
  customerTimeZone: "America/New_York",
  email: "asha@example.com",
  phone: "+919876543210",
  source: "manychat",
  campaign: `fit"reel'<b>`,
};

describe("formatWhen", () => {
  it("formats in the given zone with abbreviation and IANA name", () => {
    expect(formatWhen(start, "Asia/Kolkata")).toBe("Wednesday, 21 October 2026 · 7:30 PM IST (Asia/Kolkata)");
    expect(formatWhen(start, "America/New_York")).toBe("Wednesday, 21 October 2026 · 10:00 AM EDT (America/New_York)");
    expect(formatWhen(start, "Europe/London")).toBe("Wednesday, 21 October 2026 · 3:00 PM BST (Europe/London)");
  });
  it("falls back to UTC for an invalid zone", () => {
    expect(formatWhen(start, "Not/AZone")).toBe("Wednesday, 21 October 2026 · 2:00 PM (UTC)");
  });
});

describe("escaping", () => {
  it("escapes HTML special characters", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  it("never emits raw interpolated HTML", () => {
    for (const email of [bookingConfirmed(base), bookingRescheduled(base), bookingCancelled(base), reminder({ ...base, offsetMinutes: 60 })]) {
      expect(email.html).not.toContain("<script>");
      expect(email.html).toContain("&lt;script&gt;");
      if (!email.subject.includes("cancelled")) expect(email.html).toContain("https://meet.example.com/abc?x=1&amp;y=2");
    }
    const t = teamNewBooking(team);
    expect(t.html).not.toContain("<b>");
    expect(t.html).toContain("fit&quot;reel&#39;&lt;b&gt;");
  });
  it("drops non-http links", () => {
    const e = bookingConfirmed({ ...base, meetingUrl: "javascript:alert(1)", manageUrl: "javascript:alert(2)" });
    expect(e.html).not.toContain("javascript:");
    expect(e.text).not.toContain("javascript:");
  });
});

describe("customer templates", () => {
  it("confirmed: details in customer zone, manage + meeting links", () => {
    const e = bookingConfirmed(base);
    expect(e.subject).toContain("CSS-7K3P9Q");
    expect(e.text).toContain("Wednesday, 21 October 2026 · 7:30 PM IST (Asia/Kolkata)");
    expect(e.text).toContain("http://localhost:3000/booking/manage/tok");
    expect(e.text).toContain("https://meet.example.com/abc?x=1&y=2");
    expect(e.html).toContain("#111214");
    expect(e.html).toContain("#E8A33D");
    expect(e.html).toContain("mithilesh_lifts · Coach Scale Systems");
  });
  it("handles null meeting and manage links", () => {
    const e = bookingConfirmed({ ...base, meetingUrl: null, manageUrl: null });
    expect(e.text).toContain("Our sales team will call you on your verified number at this time.");
    expect(e.text).toContain("Message us on Instagram");
    expect(e.html).not.toContain("Reschedule or cancel</a>");
    expect(e.html).not.toContain("null");
    expect(e.text).not.toContain("null");
  });
  it("cancelled never includes a manage link", () => {
    const e = bookingCancelled(base);
    expect(e.text).not.toContain("/booking/manage/");
    expect(e.subject).toMatch(/cancelled/i);
  });
  it("reminder wording follows the offset", () => {
    expect(reminderWording(1440)).toBe("in 24 hours");
    expect(reminderWording(60)).toBe("in 1 hour");
    expect(reminder({ ...base, offsetMinutes: 1440 }).subject).toContain("in 24 hours");
    expect(reminder({ ...base, offsetMinutes: 60 }).text).toContain("in 1 hour");
  });
});

describe("team templates", () => {
  it("show the coach's zone and contact details", () => {
    const e = teamNewBooking(team);
    expect(e.text).toContain("7:30 PM IST (Asia/Kolkata)");
    expect(e.text).toContain("America/New_York");
    expect(e.text).toContain("+919876543210");
    expect(e.text).toContain("asha@example.com");
    expect(e.text).toContain("manychat");
  });
  it("changed variants", () => {
    expect(teamBookingChanged({ ...team, change: "cancelled" }).subject).toMatch(/cancelled/);
    expect(teamBookingChanged({ ...team, change: "rescheduled" }).subject).toMatch(/rescheduled/);
    expect(teamNewBooking({ ...team, source: null, campaign: null, meetingUrl: null }).text).toContain("Source: —");
  });
});
