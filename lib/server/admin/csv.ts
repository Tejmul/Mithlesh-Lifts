// CSV helpers for admin exports. No server-only import: pure functions, unit-tested directly.

export type CsvValue = string | number | boolean | Date | null | undefined;

/** Characters that make spreadsheet apps evaluate a cell as a formula (OWASP CSV injection). */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
/** E.164 phone numbers start with "+" but can't be formulas — export them as-is so they stay usable. */
const PHONE_E164 = /^\+\d{6,15}$/;

/** One CSV cell: neutralises formula injection, then quotes/escapes per RFC 4180 when needed. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && FORMULA_PREFIX.test(text) && !PHONE_E164.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** One CSV line including the trailing CRLF. */
export function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(",") + "\r\n";
}
