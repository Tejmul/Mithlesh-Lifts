import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "@/lib/server/admin/csv";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("Ravi Kumar")).toBe("Ravi Kumar");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(csvCell(" padded ")).toBe('" padded "');
  });

  it("neutralises formula injection", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=cmd")).toBe("'\t=cmd");
    expect(csvCell("=1,2")).toBe("\"'=1,2\"");
  });

  it("does not prefix numbers or dates", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05.000Z");
  });
});

describe("csvRow", () => {
  it("joins cells with commas and ends with CRLF", () => {
    expect(csvRow(["a", "b,c", null, "=x"])).toBe("a,\"b,c\",,'=x\r\n");
  });
});

describe("phone numbers", () => {
  it("keeps E.164 numbers usable but still neutralises +formulas", () => {
    expect(csvCell("+919876543210")).toBe("+919876543210");
    expect(csvCell("+1+2")).toBe("'+1+2");
    expect(csvCell("+SUM(A1)")).toBe("'+SUM(A1)");
  });
});
