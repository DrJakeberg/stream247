import { beforeEach, describe, expect, it, vi } from "vitest";
import { isProtectedAuditEventType } from "@stream247/core";

/**
 * M127, team sign-in with Twitch: every failed callback wrote a protected "twitch.error" audit row,
 * unthrottled, and an anonymous client can fail it as often as it likes (/api/auth/twitch/login hands
 * out a fresh state cookie, and a made-up code fails the exchange). Enough of them pushed sign-ins,
 * grants and deletions out of the protected audit window. Each failure also wrote the identity
 * connection row from a snapshot, although it says nothing about that connection.
 */
const { NotAuthorized } = vi.hoisted(() => ({
  NotAuthorized: class TwitchLoginNotAuthorizedError extends Error {
    constructor(login: string) {
      super(`Twitch user ${login} is not authorized for this workspace.`);
    }
  }
}));
const mocks = vi.hoisted(() => ({
  consumeOAuthState: vi.fn(),
  appendAuditEvent: vi.fn(),
  recordTwitchError: vi.fn(),
  exchangeTwitchLoginCode: vi.fn(),
  setSessionCookie: vi.fn()
}));

vi.mock("@/lib/server/oauth-state", () => ({
  consumeOAuthState: mocks.consumeOAuthState,
  describeOAuthStateFailure: (reason: string) => `state failure: ${reason}`
}));
vi.mock("@/lib/server/state", () => ({
  readAppState: async () => ({ managedConfig: { appUrl: "https://stream.example" } }),
  appendAuditEvent: mocks.appendAuditEvent
}));
vi.mock("@/lib/server/twitch", () => ({
  exchangeTwitchLoginCode: mocks.exchangeTwitchLoginCode,
  getAbsoluteAppUrl: (_state: unknown, path: string) => `https://stream.example${path}`,
  recordTwitchError: mocks.recordTwitchError,
  TwitchLoginNotAuthorizedError: NotAuthorized
}));
vi.mock("@/lib/server/auth", () => ({
  sessionPasswordHash: () => "",
  setSessionCookie: mocks.setSessionCookie
}));
vi.mock("next/server", () => ({
  NextResponse: {
    redirect(url: string) {
      return new Response(null, { status: 307, headers: { location: url } });
    }
  }
}));

import { GET } from "../../apps/web/app/api/auth/twitch/callback/route";
import {
  claimTeamLoginFailureAudit,
  clearTeamLoginAuditThrottleForTests,
  shouldAuditTeamLoginFailure
} from "../../apps/web/lib/server/team-login-audit-throttle";

function callback(query: string): never {
  const url = new URL(`https://stream.example/api/auth/twitch/callback?${query}`);
  return { nextUrl: url } as never;
}

function auditTypes(): string[] {
  return mocks.appendAuditEvent.mock.calls.map(([type]) => type as string);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  clearTeamLoginAuditThrottleForTests();
});

describe("M127: failed team sign-ins leave a throttled, unprotected audit row", () => {
  it("writes one row per failure kind for 100 anonymous failures, and never the connection row", async () => {
    mocks.consumeOAuthState.mockResolvedValue({ ok: false, reason: "missing-state" });
    for (let index = 0; index < 50; index += 1) {
      expect((await GET(callback("code=x"))).headers.get("location")).toBe("https://stream.example/login?error=state");
    }
    mocks.consumeOAuthState.mockResolvedValue({ ok: false, reason: "mismatch" });
    for (let index = 0; index < 50; index += 1) {
      await GET(callback("code=x&state=forged"));
    }

    expect(auditTypes()).toEqual(["twitch.login_rejected", "twitch.login_rejected"]);
    expect(mocks.appendAuditEvent.mock.calls.map(([, message]) => message)).toEqual([
      "Team sign-in with Twitch was refused: state failure: missing-state",
      "Team sign-in with Twitch was refused: state failure: mismatch"
    ]);
    expect(mocks.recordTwitchError).not.toHaveBeenCalled();
  });

  it("covers Twitch's error answer, a missing code and a failed exchange the same way", async () => {
    mocks.consumeOAuthState.mockResolvedValue({ ok: true });
    mocks.exchangeTwitchLoginCode.mockRejectedValue(new Error("Twitch team login token exchange failed with status 400."));

    for (let index = 0; index < 20; index += 1) {
      await GET(callback("state=s&error=access_denied"));
      await GET(callback("state=s"));
      expect((await GET(callback("state=s&code=garbage"))).headers.get("location")).toBe(
        "https://stream.example/login?error=unauthorized"
      );
    }

    expect(auditTypes()).toEqual(["twitch.login_rejected", "twitch.login_rejected", "twitch.login_rejected"]);
    expect(mocks.appendAuditEvent.mock.calls.map(([, message]) => message)).toEqual([
      "Team sign-in with Twitch was refused: Twitch answered access_denied.",
      "Team sign-in with Twitch was refused: the callback did not include an authorization code.",
      "Team sign-in with Twitch was refused: Twitch team login token exchange failed with status 400."
    ]);
    expect(mocks.recordTwitchError).not.toHaveBeenCalled();
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it("sanitises and bounds the error text the caller chose", async () => {
    mocks.consumeOAuthState.mockResolvedValue({ ok: true });
    const hostile = `evil​\r\nFAKE: owner signed in${"!".repeat(500)}`;

    await GET(callback(`state=s&error=${encodeURIComponent(hostile)}`));

    const [, message] = mocks.appendAuditEvent.mock.calls[0];
    expect(message).not.toMatch(/[\r\n​]/);
    expect(message).toContain("Twitch answered evil FAKE: owner signed in!");
    expect(message.length).toBeLessThanOrEqual("Team sign-in with Twitch was refused: Twitch answered .".length + 80);
  });

  it("keeps a real Twitch account without a grant apart from made-up codes", async () => {
    // A stranger completing Twitch sign-in is worth a row even while somebody floods garbage codes.
    mocks.consumeOAuthState.mockResolvedValue({ ok: true });
    mocks.exchangeTwitchLoginCode.mockRejectedValue(new Error("Twitch team login token exchange failed with status 400."));
    for (let index = 0; index < 50; index += 1) {
      await GET(callback("state=s&code=garbage"));
    }
    mocks.exchangeTwitchLoginCode.mockRejectedValueOnce(new NotAuthorized("stranger"));

    expect((await GET(callback("state=s&code=real"))).headers.get("location")).toBe(
      "https://stream.example/login?error=unauthorized"
    );

    expect(mocks.appendAuditEvent.mock.calls.map(([, message]) => message)).toEqual([
      "Team sign-in with Twitch was refused: Twitch team login token exchange failed with status 400.",
      "Team sign-in with Twitch was refused: Twitch user stranger is not authorized for this workspace."
    ]);
  });

  it("says in the next row how many failures of its kind were left out", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    try {
      mocks.consumeOAuthState.mockResolvedValue({ ok: false, reason: "mismatch" });
      for (let index = 0; index < 40; index += 1) {
        await GET(callback("code=x&state=forged"));
      }
      vi.setSystemTime(1_000_000 + 61_000);
      await GET(callback("code=x&state=forged"));
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.appendAuditEvent.mock.calls.map(([, message]) => message)).toEqual([
      "Team sign-in with Twitch was refused: state failure: mismatch",
      "Team sign-in with Twitch was refused: state failure: mismatch (39 more of this kind since the last such row)"
    ]);
  });

  it("uses an audit type that the protected retention window does not keep", () => {
    expect(isProtectedAuditEventType("twitch.login_rejected")).toBe(false);
    // The type it replaces is protected, which is what made the flood dangerous.
    expect(isProtectedAuditEventType("twitch.error")).toBe(true);
  });
});

describe("M127: shouldAuditTeamLoginFailure", () => {
  it("allows one row per reason per minute", () => {
    expect(shouldAuditTeamLoginFailure("missing-state", 1_000)).toBe(true);
    expect(shouldAuditTeamLoginFailure("missing-state", 60_999)).toBe(false);
    expect(shouldAuditTeamLoginFailure("mismatch", 2_000)).toBe(true);
    expect(shouldAuditTeamLoginFailure("missing-state", 61_000)).toBe(true);
  });

  it("caps all reasons together at ten rows per window", () => {
    for (let index = 0; index < 10; index += 1) {
      expect(shouldAuditTeamLoginFailure(`reason-${index}`, 5_000)).toBe(true);
    }
    expect(shouldAuditTeamLoginFailure("reason-10", 5_000)).toBe(false);
    expect(shouldAuditTeamLoginFailure("reason-10", 65_000)).toBe(true);
  });

  it("counts what it left out per reason and hands the count to the next row", () => {
    expect(claimTeamLoginFailureAudit("exchange-failed", 1_000)).toBe(0);
    expect(claimTeamLoginFailureAudit("exchange-failed", 2_000)).toBeNull();
    expect(claimTeamLoginFailureAudit("exchange-failed", 3_000)).toBeNull();
    expect(claimTeamLoginFailureAudit("not-authorized", 4_000)).toBe(0);
    expect(claimTeamLoginFailureAudit("exchange-failed", 61_000)).toBe(2);
    expect(claimTeamLoginFailureAudit("exchange-failed", 121_000)).toBe(0);
  });
});
