import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone, sendCodeSchema } from "@/lib/shared/validation";

describe("normalizePhone", () => {
  it.each([
    ["IN", "98765 43210", "+919876543210"],
    ["in", "+91 98765-43210", "+919876543210"],
    ["IN", "098765 43210", "+919876543210"],
    ["US", "(201) 555-0123", "+12015550123"],
    ["GB", "07400 123456", "+447400123456"],
  ])("%s %s → %s", (country, phone, expected) => {
    expect(normalizePhone(country, phone)).toBe(expected);
  });

  it.each([
    ["IN", "12345"],
    ["IN", "98765"],
    ["US", "555-0123"],
    ["GB", "07400 12"],
    ["US", "not a number"],
  ])("rejects %s %s", (country, phone) => {
    expect(normalizePhone(country, phone)).toBeNull();
  });

  it("sendCodeSchema flags invalid numbers on the phone field", () => {
    const r = sendCodeSchema.safeParse({ country: "IN", phone: "12345", mode: "login" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["phone"]);
    expect(sendCodeSchema.safeParse({ country: "IN", phone: "9876543210", mode: "login" }).success).toBe(true);
  });

  it("sendCodeSchema requires a name for signup (the default mode)", () => {
    const r = sendCodeSchema.safeParse({ country: "IN", phone: "9876543210" });
    expect(r.error?.issues.map((i) => i.path)).toEqual([["fullName"]]);
    expect(sendCodeSchema.safeParse({ country: "IN", phone: "9876543210", fullName: "Asha Rao" }).success).toBe(true);
  });
});

describe("maskPhone", () => {
  it("hides the middle of the number", () => {
    expect(maskPhone("+919876543210")).toBe("+9198••••210");
    expect(maskPhone("+12015550123")).toBe("+1201••••123");
    expect(maskPhone("+919876543210")).not.toContain("76543");
  });
  it("leaves very short strings alone", () => {
    expect(maskPhone("+12345")).toBe("+12345");
  });
});
