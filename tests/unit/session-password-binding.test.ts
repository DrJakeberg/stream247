import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { hashPassword, resolveAppSecret } from "@stream247/db";

// M117 (suggestion 9): a session is bound to the password it signed in with, so changing or resetting
// the owner password ends every session opened with the old one, a leaked one included.

vi.mock("../../apps/web/node_modules/next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { buildSessionValue, parseSessionValue, resolveSessionUser, sessionPasswordHash } from "../../apps/web/lib/server/auth";

const oldHash = hashPassword("old-owner-password");
const newHash = hashPassword("new-owner-password-2026");
const owner = { id: "user_owner", email: "owner@example.com", authProvider: "local" as const, role: "owner" as const, passwordHash: oldHash };
const editor = {
  id: "user_editor",
  email: "",
  authProvider: "twitch" as const,
  role: "operator" as const,
  passwordHash: "",
  twitchUserId: "tw-editor",
  twitchLogin: "editor"
};

function stateWith(ownerHash: string) {
  return {
    owner: { email: owner.email, passwordHash: ownerHash, createdAt: "" },
    users: [{ ...owner, passwordHash: ownerHash }, editor],
    // Since M125 a Twitch sign-in holds the role of its current grant.
    teamAccessGrants: [{ id: "grant_editor", twitchLogin: "editor", twitchUserId: "tw-editor", role: "operator", createdAt: "", createdBy: "" }],
    twitch: { broadcasterId: "" }
  } as never;
}

describe("sessions bound to the owner password (M117)", () => {
  it("accepts a session signed in with the current password", () => {
    const state = stateWith(oldHash);
    const cookie = buildSessionValue(owner.id, sessionPasswordHash(owner, state as never));
    expect(resolveSessionUser(cookie, state)?.id).toBe("user_owner");
  });

  it("ends it once the password changes, and accepts a session for the new one", () => {
    const before = stateWith(oldHash);
    const oldCookie = buildSessionValue(owner.id, sessionPasswordHash(owner, before as never));
    const after = stateWith(newHash);
    expect(resolveSessionUser(oldCookie, after)).toBeNull();
    expect(resolveSessionUser(buildSessionValue(owner.id, newHash), after)?.id).toBe("user_owner");
  });

  it("reads the owner hash from system_state when the user row has none, as the sign-in does", () => {
    const state = { owner: { email: owner.email, passwordHash: oldHash, createdAt: "" }, users: [{ ...owner, passwordHash: "" }] } as never;
    expect(sessionPasswordHash({ authProvider: "local", passwordHash: "" }, state)).toBe(oldHash);
    expect(resolveSessionUser(buildSessionValue(owner.id, oldHash), state)?.id).toBe("user_owner");
  });

  it("leaves Twitch sign-ins of the team signed in through an owner password change", () => {
    const cookie = buildSessionValue(editor.id, sessionPasswordHash(editor, stateWith(oldHash) as never));
    expect(resolveSessionUser(cookie, stateWith(newHash))?.id).toBe("user_editor");
  });

  it("refuses a cookie from before M117, a forged stamp and a tampered one", () => {
    const state = stateWith(oldHash);
    const valid = buildSessionValue(owner.id, oldHash);
    const [userId, issuedAt, stamp, signature] = valid.split(":");
    expect(parseSessionValue(valid)).toEqual({ userId, passwordStamp: stamp });
    // The pre-M117 shape userId:issuedAt:signature, even with a signature over that payload.
    expect(parseSessionValue(`${userId}:${issuedAt}:${signature}`)).toBeNull();
    expect(resolveSessionUser(`${userId}:${issuedAt}:${"0".repeat(16)}:${signature}`, state)).toBeNull();
    // A correctly signed cookie whose stamp is of another password reaches the stamp check and fails it.
    const otherStamp = buildSessionValue(owner.id, hashPassword("some-other-password"));
    expect(parseSessionValue(otherStamp)?.userId).toBe("user_owner");
    expect(resolveSessionUser(otherStamp, state)).toBeNull();
    expect(resolveSessionUser(`user_editor:${issuedAt}:${stamp}:${signature}`, state)).toBeNull();
  });

  it("still expires a session after its lifetime", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const cookie = buildSessionValue(owner.id, oldHash);
      vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
      expect(resolveSessionUser(cookie, stateWith(oldHash))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// M127 (finding 6): a sign-out ends every session of the account on the server, through a per-user
// epoch in the stamp, and a session lasts 14 days by default, as long as the cookie.
describe("sessions bound to the account's session epoch (M127)", () => {
  function withEpoch(epoch: number) {
    const state = stateWith(oldHash) as { users: Array<Record<string, unknown>> };
    return { ...state, users: state.users.map((user) => ({ ...user, sessionEpoch: epoch })) } as never;
  }

  it("ends the owner's and a team member's sessions once their epoch moves on", () => {
    const ownerCookie = buildSessionValue(owner.id, oldHash, 0);
    const editorCookie = buildSessionValue(editor.id, "", 0);
    expect(resolveSessionUser(ownerCookie, withEpoch(0))?.id).toBe("user_owner");
    expect(resolveSessionUser(editorCookie, withEpoch(0))?.id).toBe("user_editor");
    expect(resolveSessionUser(ownerCookie, withEpoch(1))).toBeNull();
    expect(resolveSessionUser(editorCookie, withEpoch(1))).toBeNull();
    expect(resolveSessionUser(buildSessionValue(owner.id, oldHash, 1), withEpoch(1))?.id).toBe("user_owner");
    expect(resolveSessionUser(buildSessionValue(editor.id, "", 1), withEpoch(1))?.id).toBe("user_editor");
  });

  it("keeps a cookie issued before the update valid: epoch 0 signs the stamp as before", () => {
    // The pre-M127 stamp, built by hand: the first 16 hex characters of HMAC(password:<hash>).
    const sign = (value: string) => createHmac("sha256", resolveAppSecret()).update(value).digest("hex");
    const payload = `${owner.id}:${Date.now()}:${sign(`password:${oldHash}`).slice(0, 16)}`;
    const preUpdateCookie = `${payload}:${sign(payload)}`;
    expect(resolveSessionUser(preUpdateCookie, stateWith(oldHash))?.id).toBe("user_owner");
    expect(resolveSessionUser(preUpdateCookie, withEpoch(0))?.id).toBe("user_owner");
    expect(resolveSessionUser(preUpdateCookie, withEpoch(1))).toBeNull();
  });

  it("refuses a session 15 days after sign-in without SESSION_MAX_AGE_SECONDS", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const cookie = buildSessionValue(owner.id, oldHash);
      vi.setSystemTime(new Date("2026-01-14T23:00:00Z"));
      expect(resolveSessionUser(cookie, stateWith(oldHash))?.id).toBe("user_owner");
      vi.setSystemTime(new Date("2026-01-16T00:00:00Z"));
      expect(resolveSessionUser(cookie, stateWith(oldHash))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
