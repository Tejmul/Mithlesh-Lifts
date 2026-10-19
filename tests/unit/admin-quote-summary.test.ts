import { describe, expect, it } from "vitest";
import { bookingWhere, parseBookingFilters } from "@/lib/server/admin/bookings-query";
import {
  cleanAmountInput,
  formatInr,
  latestQuote,
  leadDisplayName,
  summarizeQuotes,
  type QuoteLike,
} from "@/lib/server/admin/quote-summary";

const q = (status: QuoteLike["status"], amountInr: number, day: number): QuoteLike => ({
  status,
  amountInr,
  createdAt: new Date(Date.UTC(2026, 9, day)),
});

describe("summarizeQuotes", () => {
  it("shows a dash with no quotes or only cancelled ones", () => {
    expect(summarizeQuotes([])).toEqual({ label: "—", tone: "none" });
    expect(summarizeQuotes([q("CANCELLED", 5000, 1)])).toEqual({ label: "—", tone: "none" });
  });

  it("shows the newest open quote", () => {
    const s = summarizeQuotes([q("SENT", 8000, 1), q("SENT", 12000, 3), q("CANCELLED", 15000, 4)]);
    expect(s.tone).toBe("sent");
    expect(s.label).toBe(`Quote sent ${formatInr(12000)}`);
  });

  it("prefers a paid quote over a newer open one", () => {
    const s = summarizeQuotes([q("PAID", 12000, 1), q("SENT", 20000, 5)]);
    expect(s).toEqual({ label: `Paid ${formatInr(12000)}`, tone: "paid" });
  });
});

describe("latestQuote", () => {
  it("returns the newest quote of any status, or null", () => {
    expect(latestQuote([])).toBeNull();
    expect(latestQuote([q("PAID", 1, 1), q("CANCELLED", 2, 9), q("SENT", 3, 4)])?.amountInr).toBe(2);
  });
});

describe("formatInr", () => {
  it("uses Indian grouping and no paise", () => {
    expect(formatInr(125000)).toBe("₹1,25,000");
  });
});

describe("leadDisplayName", () => {
  it("combines name and client ID, falling back to the phone", () => {
    expect(leadDisplayName({ fullName: "Rahul S", clientCode: "RAHUL-4821", phoneE164: "+919876543210" })).toBe(
      "Rahul S (RAHUL-4821)",
    );
    expect(leadDisplayName({ fullName: null, clientCode: "RAHUL-4821", phoneE164: "+919876543210" })).toBe("RAHUL-4821");
    expect(leadDisplayName({ fullName: "  ", clientCode: null, phoneE164: "+919876543210" })).toBe("+919876543210");
  });
});

describe("cleanAmountInput", () => {
  it("strips separators and the rupee sign", () => {
    expect(cleanAmountInput("₹ 12,000")).toBe("12000");
    expect(cleanAmountInput(null)).toBe("");
  });
});

describe("bookingWhere search", () => {
  it("matches the client ID", () => {
    const where = bookingWhere(parseBookingFilters({ q: "rahul-48" }), "Asia/Kolkata");
    expect(JSON.stringify(where)).toContain('"clientCode":{"contains":"rahul-48","mode":"insensitive"}');
  });
});
