import { beforeEach, describe, expect, it } from "vitest";
import { authenticate, LOGIN_FAILED_MESSAGE, resolveSession, revokeSession } from "@/lib/server/admin/auth";
import { hashPassword, hashToken } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { ApiException } from "@/lib/server/http";
import { resetDb } from "../helpers/db";

const EMAIL = "coach@example.com";
const PASSWORD = "correct horse battery staple";

async function createAdmin(email = EMAIL, password = PASSWORD) {
  return db.adminUser.create({ data: { email, name: "Coach", passwordHash: await hashPassword(password) } });
}

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiException);
  expect((err as ApiException).status).toBe(status);
  expect((err as ApiException).code).toBe(code);
  return err as ApiException;
}

describe("admin auth", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("logs in with the right password and stores only a hash of the token", async () => {
    const admin = await createAdmin();
    const { token, expiresAt } = await authenticate("  Coach@Example.com ", PASSWORD, "1.1.1.1");
    expect(token.length).toBeGreaterThan(30);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    const sessions = await db.adminSession.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(hashToken(token));
    expect(sessions[0]!.tokenHash).not.toContain(token);

    const resolved = await resolveSession(token);
    expect(resolved?.id).toBe(admin.id);
    expect((await db.adminUser.findUnique({ where: { id: admin.id } }))?.lastLoginAt).not.toBeNull();
  });

  it("returns the same generic error for a wrong password and an unknown email", async () => {
    await createAdmin();
    const wrong = await expectApiError(authenticate(EMAIL, "wrong password!!", "1.1.1.1"), 401, "UNAUTHORIZED");
    const unknown = await expectApiError(authenticate("nobody@example.com", PASSWORD, "1.1.1.1"), 401, "UNAUTHORIZED");
    expect(wrong.message).toBe(LOGIN_FAILED_MESSAGE);
    expect(unknown.message).toBe(LOGIN_FAILED_MESSAGE);
    expect(await db.adminSession.count()).toBe(0);
  });

  it("locks an email out after 5 attempts, even with the right password", async () => {
    await createAdmin();
    for (let i = 0; i < 5; i++) {
      await expectApiError(authenticate(EMAIL, `wrong-${i}-password`, `10.0.0.${i}`), 401, "UNAUTHORIZED");
    }
    await expectApiError(authenticate(EMAIL, PASSWORD, "10.0.0.99"), 429, "RATE_LIMITED");
  });

  it("locks an IP out after 10 attempts across emails", async () => {
    await createAdmin();
    for (let i = 0; i < 10; i++) {
      await expectApiError(authenticate(`user${i}@example.com`, "whatever-password", "9.9.9.9"), 401, "UNAUTHORIZED");
    }
    await expectApiError(authenticate(EMAIL, PASSWORD, "9.9.9.9"), 429, "RATE_LIMITED");
    // A different IP is unaffected.
    await expect(authenticate(EMAIL, PASSWORD, "8.8.8.8")).resolves.toHaveProperty("token");
  });

  it("rejects and deletes expired sessions", async () => {
    await createAdmin();
    const { token } = await authenticate(EMAIL, PASSWORD, "1.1.1.1");
    await db.adminSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveSession(token)).toBeNull();
    expect(await db.adminSession.count()).toBe(0);
  });

  it("rejects sessions once the clock passes the 7-day expiry", async () => {
    await createAdmin();
    const { token } = await authenticate(EMAIL, PASSWORD, "1.1.1.1");
    expect(await resolveSession(token, new Date(Date.now() + 6 * 86_400_000))).not.toBeNull();
    expect(await resolveSession(token, new Date(Date.now() + 8 * 86_400_000))).toBeNull();
  });

  it("logout (revokeSession) invalidates the token", async () => {
    await createAdmin();
    const a = await authenticate(EMAIL, PASSWORD, "1.1.1.1");
    const b = await authenticate(EMAIL, PASSWORD, "1.1.1.1");
    await revokeSession(a.token);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).not.toBeNull();
  });

  it("ignores missing or garbage tokens", async () => {
    expect(await resolveSession(undefined)).toBeNull();
    expect(await resolveSession("")).toBeNull();
    expect(await resolveSession("not-a-real-token")).toBeNull();
  });
});
