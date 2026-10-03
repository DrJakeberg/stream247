import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@stream247/db";

// M91, owner decision 5.1 Q8: the owner password is changed under Admin → Settings → Security, and only
// with the current password. The route runs for real with the real scrypt format; only the session and
// the database write are stood in for.

const OLD_PASSWORD = "old-owner-password";
const NEW_PASSWORD = "new-owner-password-2026";

const mocks = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  setOwnerPasswordHash: vi.fn(),
  appendAuditEvent: vi.fn()
}));

vi.mock("@/lib/server/auth", async () => {
  const db = await import("@stream247/db");
  return {
    getAuthenticatedUser: async () => mocks.user,
    hashPassword: db.hashPassword,
    verifyPassword: db.verifyPassword
  };
});
vi.mock("@/lib/server/state", () => ({
  readAppState: async () => ({ owner: { email: "owner@example.com", passwordHash: String(mocks.user?.passwordHash ?? ""), createdAt: "" } }),
  setOwnerPasswordHash: mocks.setOwnerPasswordHash,
  appendAuditEvent: mocks.appendAuditEvent
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  }
}));

import { POST } from "../../apps/web/app/api/auth/password/route";
import { clearAllRateLimits } from "../../apps/web/lib/server/rate-limit";

function requestWith(body: unknown) {
  return { json: async () => body, headers: new Headers() } as never;
}

describe("POST /api/auth/password (M91, I7)", () => {
  beforeEach(() => {
    clearAllRateLimits();
    mocks.setOwnerPasswordHash.mockReset().mockResolvedValue("owner@example.com");
    mocks.appendAuditEvent.mockReset();
    mocks.user = {
      id: "user_owner",
      email: "owner@example.com",
      authProvider: "local",
      role: "owner",
      passwordHash: hashPassword(OLD_PASSWORD)
    };
  });

  it("refuses a wrong current password and changes nothing", async () => {
    const response = await POST(requestWith({ currentPassword: "not-the-password", newPassword: NEW_PASSWORD }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ message: "The current password is not correct." });
    expect(mocks.setOwnerPasswordHash).not.toHaveBeenCalled();
  });

  it("changes it with the right current password, to a hash the sign-in accepts", async () => {
    const response = await POST(requestWith({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }));
    expect(response.status).toBe(200);
    expect(mocks.setOwnerPasswordHash).toHaveBeenCalledTimes(1);
    const stored = String(mocks.setOwnerPasswordHash.mock.calls[0]?.[0]);
    expect(verifyPassword(NEW_PASSWORD, stored)).toBe(true);
    expect(verifyPassword(OLD_PASSWORD, stored)).toBe(false);
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith("auth.password.changed", "Owner password changed by owner@example.com.");
  });

  it("refuses a new password under 10 characters", async () => {
    const response = await POST(requestWith({ currentPassword: OLD_PASSWORD, newPassword: "short" }));
    expect(response.status).toBe(400);
    expect(mocks.setOwnerPasswordHash).not.toHaveBeenCalled();
  });

  it("refuses without a session and for accounts that sign in with Twitch", async () => {
    mocks.user = null;
    expect((await POST(requestWith({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }))).status).toBe(401);
    mocks.user = { id: "user_bot", email: "", authProvider: "twitch", role: "owner", passwordHash: "" };
    expect((await POST(requestWith({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }))).status).toBe(403);
    expect(mocks.setOwnerPasswordHash).not.toHaveBeenCalled();
  });
});
