import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOutbox, readOutbox } from "@/lib/server/dev-outbox";
import { resetEnvCache } from "@/lib/server/env";
import { checkPhoneVerification, startPhoneVerification } from "@/lib/server/phone-verify";
import { MOCK_MAX_ATTEMPTS, resetMockPhoneVerify } from "@/lib/server/phone-verify/mock";

const PHONE = "+919876543210";

function lastCode(to = PHONE) {
  const msgs = readOutbox({ to, channel: "sms" });
  const m = msgs.at(-1)?.body.match(/(\d{6})$/);
  if (!m) throw new Error("no code in outbox");
  return m[1]!;
}
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("mock phone verification", () => {
  beforeEach(() => {
    process.env.PHONE_VERIFY_PROVIDER = "mock";
    resetEnvCache();
    resetMockPhoneVerify();
    clearOutbox();
  });
  afterEach(() => vi.useRealTimers());

  it("sends a 6-digit code to the dev outbox and approves it", async () => {
    const log = vi.spyOn(console, "log");
    const info = vi.spyOn(console, "info");
    expect(await startPhoneVerification(PHONE)).toEqual({ ok: true });
    const code = lastCode();
    expect(readOutbox({ to: PHONE })[0]!.body).toBe(`Your Mithilesh Reddy verification code is ${code}`);
    for (const spy of [log, info]) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(code);
    }
    expect(await checkPhoneVerification(PHONE, code)).toEqual({ ok: true, approved: true });
    log.mockRestore();
    info.mockRestore();
  });

  it("rejects a wrong code but still accepts the right one afterwards", async () => {
    await startPhoneVerification(PHONE);
    const code = lastCode();
    expect(await checkPhoneVerification(PHONE, wrong(code))).toEqual({ ok: true, approved: false });
    expect(await checkPhoneVerification(PHONE, code)).toEqual({ ok: true, approved: true });
  });

  it("codes are bound to the phone they were sent to", async () => {
    await startPhoneVerification(PHONE);
    expect(await checkPhoneVerification("+919876543211", lastCode())).toEqual({ ok: true, approved: false });
  });

  it("expires codes after 5 minutes", async () => {
    vi.useFakeTimers();
    await startPhoneVerification(PHONE);
    const code = lastCode();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(await checkPhoneVerification(PHONE, code)).toEqual({ ok: true, approved: false });
  });

  it("locks the code after too many wrong attempts", async () => {
    await startPhoneVerification(PHONE);
    const code = lastCode();
    for (let i = 0; i < MOCK_MAX_ATTEMPTS; i++) {
      expect((await checkPhoneVerification(PHONE, wrong(code))) as { approved: boolean }).toMatchObject({ approved: false });
    }
    expect(await checkPhoneVerification(PHONE, code)).toEqual({ ok: true, approved: false });
  });

  it("codes are single use", async () => {
    await startPhoneVerification(PHONE);
    const code = lastCode();
    expect(await checkPhoneVerification(PHONE, code)).toEqual({ ok: true, approved: true });
    expect(await checkPhoneVerification(PHONE, code)).toEqual({ ok: true, approved: false });
  });

  it("a new code replaces the old one", async () => {
    await startPhoneVerification(PHONE);
    const first = lastCode();
    await startPhoneVerification(PHONE);
    const second = lastCode();
    if (first !== second) expect(await checkPhoneVerification(PHONE, first)).toMatchObject({ approved: false });
    expect(await checkPhoneVerification(PHONE, second)).toEqual({ ok: true, approved: true });
  });

  it("refuses to run in production", async () => {
    const { start } = await import("@/lib/server/phone-verify/mock");
    vi.stubEnv("NODE_ENV", "production");
    await expect(start(PHONE)).rejects.toThrow(/production/);
    vi.unstubAllEnvs();
  });
});
