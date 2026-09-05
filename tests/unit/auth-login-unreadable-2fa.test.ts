import { describe, expect, it, vi } from "vitest";

/**
 * Finding [10]: the login gate tested the two-factor secret for truthiness, so a secret that
 * could not be decrypted — an empty string — skipped the second factor. It fails closed now.
 */
const { mockFindUserByEmail, mockReadAppState, mockUpsertUserRecord, mockSetSessionCookie } = vi.hoisted(() => ({
  mockFindUserByEmail: vi.fn(),
  mockReadAppState: vi.fn(),
  mockUpsertUserRecord: vi.fn(),
  mockSetSessionCookie: vi.fn()
}));
vi.mock("@/lib/server/auth", () => ({
  buildTwoFactorChallengeValue: () => "challenge",
  setSessionCookie: mockSetSessionCookie,
  verifyPassword: () => true
}));
vi.mock("@/lib/server/state", () => ({
  findUserByEmail: mockFindUserByEmail,
  readAppState: mockReadAppState,
  upsertUserRecord: mockUpsertUserRecord
}));
vi.mock("@/lib/server/rate-limit", () => ({
  LOGIN_RATE_LIMIT: { limit: 5, windowMs: 60_000 },
  consumeRateLimit: () => ({ allowed: true, retryAfterSeconds: 0, remaining: 4 }),
  getClientIdentifier: () => "test",
  resetRateLimit: () => undefined
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  }
}));

import { POST } from "../../apps/web/app/api/auth/login/route";

function requestWith(body: unknown) {
  return { json: async () => body, headers: new Headers(), nextUrl: new URL("http://localhost/api/auth/login") } as never;
}

describe("login with an unreadable two-factor secret", () => {
  it("refuses instead of skipping the second factor", async () => {
    mockReadAppState.mockResolvedValue({ owner: { email: "owner@example.com", passwordHash: "hash" } });
    mockFindUserByEmail.mockReturnValue({ id: "u1", email: "owner@example.com", authProvider: "local", passwordHash: "hash", twoFactorEnabled: true, twoFactorSecret: "", twoFactorSecretUnreadable: true });
    const response = await POST(requestWith({ email: "owner@example.com", password: "pw" }));
    expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({ ok: false, message: expect.stringMatching(/cannot be decrypted/i) });
    expect(mockSetSessionCookie).not.toHaveBeenCalled();
  });
  it("still asks for the code when the secret opens", async () => {
    mockReadAppState.mockResolvedValue({ owner: { email: "owner@example.com", passwordHash: "hash" } });
    mockFindUserByEmail.mockReturnValue({ id: "u1", email: "owner@example.com", authProvider: "local", passwordHash: "hash", twoFactorEnabled: true, twoFactorSecret: "JBSWY3DPEHPK3PXP", twoFactorSecretUnreadable: false });
    const response = await POST(requestWith({ email: "owner@example.com", password: "pw" }));
    expect(response.status).toBe(202);
    expect(mockSetSessionCookie).not.toHaveBeenCalled();
  });
});
