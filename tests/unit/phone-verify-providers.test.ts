import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/server/env";
import { checkPhoneVerification, startPhoneVerification } from "@/lib/server/phone-verify";

const PHONE = "+919876543210";
const CODE = "482913";
const ENV_KEYS = [
  "PHONE_VERIFY_PROVIDER",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
  "MSG91_AUTH_KEY",
  "MSG91_OTP_TEMPLATE_ID",
] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, values);
  resetEnvCache();
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // No provider may ever log the code (or the phone number).
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) {
      const text = JSON.stringify(call);
      expect(text).not.toContain(CODE);
      expect(text).not.toContain("9876543210");
    }
    spy.mockRestore();
  }
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnvCache();
});

describe("Twilio Verify", () => {
  const twilioEnv = {
    PHONE_VERIFY_PROVIDER: "twilio_verify",
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "authtok",
    TWILIO_VERIFY_SERVICE_SID: "VAservice",
  };
  const basic = `Basic ${Buffer.from("ACtest:authtok").toString("base64")}`;

  it("sends a verification with form body and basic auth", async () => {
    setEnv(twilioEnv);
    fetchMock.mockResolvedValue(json(201, { status: "pending" }));
    expect(await startPhoneVerification(PHONE)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://verify.twilio.com/v2/Services/VAservice/Verifications");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(basic);
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(init.body);
    expect(form.get("To")).toBe(PHONE);
    expect(form.get("Channel")).toBe("sms");
  });

  it("send failure → ok:false without the phone number", async () => {
    setEnv(twilioEnv);
    fetchMock.mockResolvedValue(json(400, { code: 60200, message: `Invalid parameter To: ${PHONE}` }));
    const r = await startPhoneVerification(PHONE);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("9876543210");
  });

  it("approved check", async () => {
    setEnv(twilioEnv);
    fetchMock.mockResolvedValue(json(200, { status: "approved", valid: true }));
    expect(await checkPhoneVerification(PHONE, CODE)).toEqual({ ok: true, approved: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://verify.twilio.com/v2/Services/VAservice/VerificationCheck");
    expect(init.headers.Authorization).toBe(basic);
    const form = new URLSearchParams(init.body);
    expect(form.get("To")).toBe(PHONE);
    expect(form.get("Code")).toBe(CODE);
  });

  it("pending (wrong code) → approved:false", async () => {
    setEnv(twilioEnv);
    fetchMock.mockResolvedValue(json(200, { status: "pending", valid: false }));
    expect(await checkPhoneVerification(PHONE, CODE)).toEqual({ ok: true, approved: false });
  });

  it("404 (expired / no pending verification) → approved:false", async () => {
    setEnv(twilioEnv);
    fetchMock.mockResolvedValue(json(404, { code: 20404, message: "not found" }));
    expect(await checkPhoneVerification(PHONE, CODE)).toEqual({ ok: true, approved: false });
  });

  it("5xx on check → ok:false", async () => {
    setEnv(twilioEnv);
    fetchMock.mockResolvedValue(json(503, {}));
    expect((await checkPhoneVerification(PHONE, CODE)).ok).toBe(false);
  });

  it("network error → ok:false", async () => {
    setEnv(twilioEnv);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await startPhoneVerification(PHONE)).ok).toBe(false);
  });

  it("missing credentials → ok:false and no request", async () => {
    setEnv({ PHONE_VERIFY_PROVIDER: "twilio_verify", TWILIO_ACCOUNT_SID: "ACtest" });
    const s = await startPhoneVerification(PHONE);
    const c = await checkPhoneVerification(PHONE, CODE);
    expect(s).toMatchObject({ ok: false, error: expect.stringContaining("not configured") });
    expect(c).toMatchObject({ ok: false, error: expect.stringContaining("not configured") });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MSG91 OTP", () => {
  const msgEnv = { PHONE_VERIFY_PROVIDER: "msg91", MSG91_AUTH_KEY: "msgkey", MSG91_OTP_TEMPLATE_ID: "tmpl123" };

  it("sends with template, digits-only mobile and authkey header", async () => {
    setEnv(msgEnv);
    fetchMock.mockResolvedValue(json(200, { type: "success", request_id: "abc" }));
    expect(await startPhoneVerification(PHONE)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://control.msg91.com/api/v5/otp");
    expect(u.searchParams.get("template_id")).toBe("tmpl123");
    expect(u.searchParams.get("mobile")).toBe("919876543210");
    expect(init.method).toBe("POST");
    expect(init.headers.authkey).toBe("msgkey");
  });

  it("send error → ok:false", async () => {
    setEnv(msgEnv);
    fetchMock.mockResolvedValue(json(200, { type: "error", message: "Invalid authkey" }));
    expect((await startPhoneVerification(PHONE)).ok).toBe(false);
  });

  it("verify success → approved", async () => {
    setEnv(msgEnv);
    fetchMock.mockResolvedValue(json(200, { type: "success", message: "OTP verified success" }));
    expect(await checkPhoneVerification(PHONE, CODE)).toEqual({ ok: true, approved: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://control.msg91.com/api/v5/otp/verify");
    expect(u.searchParams.get("otp")).toBe(CODE);
    expect(u.searchParams.get("mobile")).toBe("919876543210");
    expect(init.method).toBe("GET");
    expect(init.headers.authkey).toBe("msgkey");
  });

  it.each(["OTP not match", "OTP expired", "Mobile no. already verified", "Max limit reached for this otp verification"])(
    "verify error %j → approved:false",
    async (message) => {
      setEnv(msgEnv);
      fetchMock.mockResolvedValue(json(200, { type: "error", message }));
      expect(await checkPhoneVerification(PHONE, CODE)).toEqual({ ok: true, approved: false });
    },
  );

  it("verify account error → ok:false", async () => {
    setEnv(msgEnv);
    fetchMock.mockResolvedValue(json(401, { type: "error", message: "Invalid authkey" }));
    expect((await checkPhoneVerification(PHONE, CODE)).ok).toBe(false);
  });

  it("missing credentials → ok:false and no request", async () => {
    setEnv({ PHONE_VERIFY_PROVIDER: "msg91" });
    expect(await startPhoneVerification(PHONE)).toMatchObject({ ok: false, error: expect.stringContaining("not configured") });
    expect(await checkPhoneVerification(PHONE, CODE)).toMatchObject({ ok: false, error: expect.stringContaining("not configured") });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
