import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M127, accounts and sessions. Each route below wrote back the whole user row it had read before its
 * checks, so a password change, a second factor or a grant change committed in between was undone
 * (sign-in, 2FA, Twitch team sign-in); 2FA setup replaced an enabled second factor with only the
 * password; and sign-out left the session valid on the server. The routes now write only what they
 * changed, through writes that check the stored row, and sign-out ends the account's sessions.
 */
const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  upsertUserRecord: vi.fn(),
  recordUserSignIn: vi.fn(),
  updateUserTwoFactorRecord: vi.fn(),
  bumpUserSessionEpoch: vi.fn(),
  appendAuditEvent: vi.fn(),
  upsertTeamAccessGrantRecord: vi.fn(),
  bindTeamAccessGrantRecord: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  parseTwoFactorChallengeValue: vi.fn(),
  verifyTotpCode: vi.fn()
}));

vi.mock("@/lib/server/state", async () => {
  const actual = await vi.importActual<typeof import("../../apps/web/lib/server/state")>("../../apps/web/lib/server/state");
  return {
    findTeamGrantForTwitchUser: actual.findTeamGrantForTwitchUser,
    getManagedTwitchConfig: () => ({ clientId: "client", clientSecret: "secret" }),
    updateTwitchConnectionRecord: vi.fn(),
    updateTwitchBroadcasterConnectionRecord: vi.fn(),
    readAppState: mocks.readAppState,
    findUserByEmail: mocks.findUserByEmail,
    findUserById: mocks.findUserById,
    upsertUserRecord: mocks.upsertUserRecord,
    recordUserSignIn: mocks.recordUserSignIn,
    updateUserTwoFactorRecord: mocks.updateUserTwoFactorRecord,
    bumpUserSessionEpoch: mocks.bumpUserSessionEpoch,
    appendAuditEvent: mocks.appendAuditEvent,
    upsertTeamAccessGrantRecord: mocks.upsertTeamAccessGrantRecord,
    bindTeamAccessGrantRecord: mocks.bindTeamAccessGrantRecord
  };
});
vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  verifyPassword: (password: string) => password === "correct-password",
  sessionPasswordHash: (user: { passwordHash?: string }) => user.passwordHash ?? "",
  buildTwoFactorChallengeValue: () => "challenge",
  parseTwoFactorChallengeValue: mocks.parseTwoFactorChallengeValue,
  setSessionCookie: mocks.setSessionCookie,
  clearSessionCookie: mocks.clearSessionCookie
}));
vi.mock("@/lib/server/two-factor", () => ({
  generateTwoFactorSecret: () => "NEWSECRET",
  buildTwoFactorOtpAuthUri: () => "otpauth://totp/new",
  verifyTotpCode: mocks.verifyTotpCode
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  }
}));

import { POST as login } from "../../apps/web/app/api/auth/login/route";
import { POST as loginTwoFactor } from "../../apps/web/app/api/auth/login/2fa/route";
import { POST as setupTwoFactor } from "../../apps/web/app/api/auth/2fa/setup/route";
import { POST as confirmTwoFactor } from "../../apps/web/app/api/auth/2fa/confirm/route";
import { POST as disableTwoFactor } from "../../apps/web/app/api/auth/2fa/disable/route";
import { POST as logout } from "../../apps/web/app/api/auth/logout/route";
import { exchangeTwitchLoginCode } from "../../apps/web/lib/server/twitch";

const owner = {
  id: "user_owner",
  email: "owner@example.com",
  displayName: "Owner",
  authProvider: "local" as const,
  role: "owner" as const,
  twitchUserId: "",
  twitchLogin: "",
  passwordHash: "hash-old",
  twoFactorEnabled: false,
  twoFactorSecret: "",
  twoFactorConfirmedAt: "",
  sessionEpoch: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: "2026-01-01T00:00:00.000Z"
};

function post(body: unknown): never {
  return new Request("https://stream.example/api", { method: "POST", body: JSON.stringify(body) }) as never;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  mocks.recordUserSignIn.mockResolvedValue(true);
  mocks.updateUserTwoFactorRecord.mockResolvedValue(true);
});

describe("a sign-in writes only its own sign-in time (finding 12)", () => {
  it("password sign-in does not write the user row it read back", async () => {
    const state = { owner: { email: owner.email, passwordHash: owner.passwordHash }, users: [owner] };
    mocks.readAppState.mockResolvedValue(state);
    mocks.findUserByEmail.mockReturnValue(owner);

    const response = await login(post({ email: owner.email, password: "correct-password" }));

    expect(response.status).toBe(200);
    expect(mocks.upsertUserRecord).not.toHaveBeenCalled();
    expect(mocks.recordUserSignIn).toHaveBeenCalledWith(owner.id, expect.any(String));
    expect(mocks.setSessionCookie).toHaveBeenCalledWith(owner.id, owner.passwordHash, owner.sessionEpoch);
  });

  it("the one-time-code step does not either", async () => {
    const user = { ...owner, twoFactorEnabled: true, twoFactorSecret: "SECRET" };
    mocks.readAppState.mockResolvedValue({ owner: { email: owner.email, passwordHash: owner.passwordHash }, users: [user] });
    mocks.findUserById.mockReturnValue(user);
    mocks.parseTwoFactorChallengeValue.mockReturnValue({ userId: user.id, issuedAt: Date.now() });
    mocks.verifyTotpCode.mockReturnValue(true);

    const response = await loginTwoFactor(post({ challengeToken: "challenge", code: "123456" }));

    expect(response.status).toBe(200);
    expect(mocks.upsertUserRecord).not.toHaveBeenCalled();
    expect(mocks.recordUserSignIn).toHaveBeenCalledWith(user.id, expect.any(String));
    expect(mocks.setSessionCookie).toHaveBeenCalledWith(user.id, user.passwordHash, user.sessionEpoch);
  });

  it("a user deleted between the read and the write gets no session", async () => {
    mocks.readAppState.mockResolvedValue({ owner: { email: owner.email, passwordHash: owner.passwordHash }, users: [owner] });
    mocks.findUserByEmail.mockReturnValue(owner);
    mocks.recordUserSignIn.mockResolvedValue(false);

    const response = await login(post({ email: owner.email, password: "correct-password" }));

    expect(response.status).toBe(401);
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });
});

describe("two-factor setup does not replace an enabled second factor (finding 1)", () => {
  it("refuses setup while 2FA is on, with the correct password, and writes nothing", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...owner, twoFactorEnabled: true, twoFactorSecret: "CURRENT" });

    const response = await setupTwoFactor(post({ password: "correct-password" }));
    const body = await json(response);

    expect(response.status).toBe(409);
    expect(body).not.toHaveProperty("secret");
    expect(body).not.toHaveProperty("otpAuthUri");
    expect(mocks.upsertUserRecord).not.toHaveBeenCalled();
    expect(mocks.updateUserTwoFactorRecord).not.toHaveBeenCalled();
  });

  it("writes the new secret only while the stored row still has 2FA off", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(owner);

    const response = await setupTwoFactor(post({ password: "correct-password" }));

    expect(response.status).toBe(200);
    expect((await json(response)).secret).toBe("NEWSECRET");
    expect(mocks.upsertUserRecord).not.toHaveBeenCalled();
    expect(mocks.updateUserTwoFactorRecord).toHaveBeenCalledWith(
      owner.id,
      { enabled: false },
      { enabled: false, secret: "NEWSECRET", confirmedAt: "" }
    );
  });

  it("answers 409 without the secret when 2FA was turned on in the meantime", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(owner);
    mocks.updateUserTwoFactorRecord.mockResolvedValue(false);

    const response = await setupTwoFactor(post({ password: "correct-password" }));

    expect(response.status).toBe(409);
    expect(await json(response)).not.toHaveProperty("secret");
  });
});

describe("confirming and disabling 2FA write only the 2FA columns (finding 12)", () => {
  it("confirm expects the secret it verified, with 2FA still off", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...owner, twoFactorSecret: "PENDING" });
    mocks.verifyTotpCode.mockReturnValue(true);

    const response = await confirmTwoFactor(post({ code: "123456" }));

    expect(response.status).toBe(200);
    expect(mocks.upsertUserRecord).not.toHaveBeenCalled();
    expect(mocks.updateUserTwoFactorRecord).toHaveBeenCalledWith(
      owner.id,
      { enabled: false, secret: "PENDING" },
      { enabled: true, confirmedAt: expect.any(String) }
    );
  });

  it("disable expects the secret it verified, with 2FA still on", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...owner, twoFactorEnabled: true, twoFactorSecret: "CURRENT" });
    mocks.verifyTotpCode.mockReturnValue(true);

    const response = await disableTwoFactor(post({ password: "correct-password", code: "123456" }));

    expect(response.status).toBe(200);
    expect(mocks.upsertUserRecord).not.toHaveBeenCalled();
    expect(mocks.updateUserTwoFactorRecord).toHaveBeenCalledWith(
      owner.id,
      { enabled: true, secret: "CURRENT" },
      { enabled: false, confirmedAt: "" }
    );
  });

  it("both answer 409 when the stored 2FA changed in the meantime", async () => {
    mocks.verifyTotpCode.mockReturnValue(true);
    mocks.updateUserTwoFactorRecord.mockResolvedValue(false);

    mocks.getAuthenticatedUser.mockResolvedValue({ ...owner, twoFactorSecret: "PENDING" });
    expect((await confirmTwoFactor(post({ code: "123456" }))).status).toBe(409);

    mocks.getAuthenticatedUser.mockResolvedValue({ ...owner, twoFactorEnabled: true, twoFactorSecret: "CURRENT" });
    expect((await disableTwoFactor(post({ password: "correct-password", code: "123456" }))).status).toBe(409);
  });
});

describe("sign-out ends the account's sessions on the server (finding 6)", () => {
  it("advances the session epoch of the signed-in user and clears the cookie", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(owner);

    const response = await logout();

    expect(response.status).toBe(200);
    expect(mocks.bumpUserSessionEpoch).toHaveBeenCalledWith(owner.id);
    expect(mocks.clearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("clears the cookie and says so when the server-side end failed", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(owner);
    mocks.bumpUserSessionEpoch.mockRejectedValue(new Error("database down"));

    const response = await logout();

    expect(response.status).toBe(503);
    expect((await json(response)).ok).toBe(false);
    expect(mocks.clearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("without a valid session it only clears the cookie", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const response = await logout();

    expect(response.status).toBe(200);
    expect(mocks.bumpUserSessionEpoch).not.toHaveBeenCalled();
    expect(mocks.clearSessionCookie).toHaveBeenCalledTimes(1);
  });
});

describe("a Twitch team sign-in binds its grant without bringing it back (finding 9)", () => {
  const grant = { id: "grant_m127", twitchLogin: "member", twitchUserId: "", role: "admin", createdAt: "", createdBy: "user_owner" };

  function stateWithGrant() {
    return {
      managedConfig: { appUrl: "https://stream.example" },
      twitch: { broadcasterId: "tw-broadcaster" },
      teamAccessGrants: [grant],
      users: []
    };
  }

  function stubTwitch(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("oauth2/token")
          ? new Response(JSON.stringify({ access_token: "token" }), { status: 200 })
          : new Response(JSON.stringify({ data: [{ id: "tw-member", login: "member", display_name: "Member" }] }), { status: 200 })
      )
    );
  }

  it("refuses the sign-in when the grant was removed after the state read, and never writes it back", async () => {
    mocks.readAppState.mockResolvedValue(stateWithGrant());
    mocks.bindTeamAccessGrantRecord.mockResolvedValue(false);
    stubTwitch();

    try {
      await expect(exchangeTwitchLoginCode("code")).rejects.toThrow("Twitch user member is not authorized for this workspace.");
    } finally {
      vi.unstubAllGlobals();
    }

    expect(mocks.upsertTeamAccessGrantRecord).not.toHaveBeenCalled();
    expect(mocks.bindTeamAccessGrantRecord).toHaveBeenCalledWith("grant_m127", "tw-member", "member");
    expect(mocks.upsertUserRecord).not.toHaveBeenCalled();
  });

  it("binds through the guarded write and signs in when the grant is still there", async () => {
    mocks.readAppState.mockResolvedValue(stateWithGrant());
    mocks.bindTeamAccessGrantRecord.mockResolvedValue(true);
    stubTwitch();

    try {
      const user = await exchangeTwitchLoginCode("code");
      expect(user.twitchUserId).toBe("tw-member");
    } finally {
      vi.unstubAllGlobals();
    }

    expect(mocks.upsertTeamAccessGrantRecord).not.toHaveBeenCalled();
    expect(mocks.upsertUserRecord).toHaveBeenCalledTimes(1);
  });
});
