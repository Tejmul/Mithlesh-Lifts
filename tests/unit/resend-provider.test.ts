import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/server/env";
import { sendEmail } from "@/lib/server/email";

const msg = { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "b1:v1:booking_confirmed:a@example.com" };

function mockFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("Resend provider", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Mithilesh Reddy <calls@example.com>");
    vi.stubEnv("EMAIL_REPLY_TO", "team@example.com");
    resetEnvCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetEnvCache();
  });

  it("sends with bearer auth and the idempotency key", async () => {
    const fetchFn = mockFetch(async () => Response.json({ id: "re_123" }));
    const result = await sendEmail(msg);
    expect(result).toEqual({ ok: true, providerMessageId: "re_123" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe(msg.idempotencyKey);
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Mithilesh Reddy <calls@example.com>",
      to: ["a@example.com"],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      reply_to: "team@example.com",
    });
  });

  it.each([429, 500, 503])("HTTP %i is retryable", async (status) => {
    mockFetch(async () => Response.json({ name: "rate_limit_exceeded" }, { status }));
    const r = await sendEmail(msg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(true);
  });

  it.each([400, 403, 422])("HTTP %i is permanent", async (status) => {
    mockFetch(async () => Response.json({ name: "validation_error", message: "bad a@example.com" }, { status }));
    const r = await sendEmail(msg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryable).toBe(false);
      expect(r.error).not.toContain("a@example.com");
    }
  });

  it("network errors are retryable and never throw", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await sendEmail(msg);
    expect(r).toMatchObject({ ok: false, retryable: true });
  });

  it("missing API key is a permanent failure without calling fetch", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    resetEnvCache();
    const fetchFn = mockFetch(async () => Response.json({ id: "x" }));
    const r = await sendEmail(msg);
    expect(r).toEqual({ ok: false, retryable: false, error: "RESEND_API_KEY not configured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
