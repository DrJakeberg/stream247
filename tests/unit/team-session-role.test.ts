import { describe, expect, it, vi } from "vitest";

// M125 (security audit 2026-10, finding 3.1 and the login-name lead): a Twitch sign-in holds the role
// of the workspace's current state on every request, not the role stored when it signed in. Lowering,
// removing or rebinding takes effect on the member's next request, and a grant follows the Twitch
// user id that first signed in with it, not a login name someone else can take over.

vi.mock("../../apps/web/node_modules/next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { findTeamGrantForTwitchUser } from "@stream247/db";
import { buildSessionValue, currentTwitchRole, resolveSessionUser } from "../../apps/web/lib/server/auth";

type Grant = { id: string; twitchLogin: string; twitchUserId: string; role: string; createdAt: string; createdBy: string };

const member = {
  id: "user_member",
  email: "member@twitch.local",
  displayName: "Member",
  authProvider: "twitch" as const,
  // What was stored at sign-in, while the grant still said admin.
  role: "admin" as const,
  passwordHash: "",
  twitchUserId: "tw-100",
  twitchLogin: "member",
  createdAt: "",
  lastLoginAt: ""
};

function grant(role: string, overrides: Partial<Grant> = {}): Grant {
  return { id: "grant_member", twitchLogin: "member", twitchUserId: "tw-100", role, createdAt: "", createdBy: "", ...overrides };
}

function stateWith(grants: Grant[], broadcasterId = "") {
  return { owner: null, users: [member], teamAccessGrants: grants, twitch: { broadcasterId } } as never;
}

const cookie = buildSessionValue(member.id, "");

describe("a Twitch sign-in's role comes from the current state (M125)", () => {
  it("drops a demoted admin to the grant's role on the old cookie", () => {
    expect(resolveSessionUser(cookie, stateWith([grant("admin")]))?.role).toBe("admin");
    expect(resolveSessionUser(cookie, stateWith([grant("viewer")]))?.role).toBe("viewer");
  });

  it("ends the session when the grant is removed", () => {
    expect(resolveSessionUser(cookie, stateWith([]))).toBeNull();
  });

  it("is owner only while its Twitch id is the bound broadcaster", () => {
    expect(resolveSessionUser(cookie, stateWith([grant("operator")], "tw-100"))?.role).toBe("owner");
    // Rebound to another account: back to the grant's role, or out without one.
    expect(resolveSessionUser(cookie, stateWith([grant("operator")], "tw-999"))?.role).toBe("operator");
    expect(resolveSessionUser(cookie, stateWith([], "tw-999"))).toBeNull();
  });

  it("never lets an empty broadcaster id make anyone owner", () => {
    expect(currentTwitchRole({ twitchUserId: "", twitchLogin: "member" }, stateWith([], ""))).toBeNull();
  });

  it("leaves local sign-ins to the password stamp", () => {
    const owner = { ...member, id: "user_owner", authProvider: "local" as const, role: "owner" as const, passwordHash: "" };
    const state = { owner: { email: "", passwordHash: "", createdAt: "" }, users: [owner], teamAccessGrants: [], twitch: { broadcasterId: "" } } as never;
    expect(resolveSessionUser(buildSessionValue(owner.id, ""), state)?.role).toBe("owner");
  });
});

describe("a team grant follows the Twitch user id (M125)", () => {
  it("matches a bound grant by id, also after a rename", () => {
    const state = stateWith([grant("moderator")]);
    expect(findTeamGrantForTwitchUser(state, "tw-100", "renamed_member")?.role).toBe("moderator");
  });

  it("gives a released login nothing when another account took it", () => {
    const state = stateWith([grant("admin")]);
    expect(findTeamGrantForTwitchUser(state, "tw-200", "member")).toBeNull();
  });

  it("matches an unbound grant by login until its first sign-in binds it", () => {
    const state = stateWith([grant("operator", { twitchUserId: "" })]);
    expect(findTeamGrantForTwitchUser(state, "tw-300", "MEMBER")?.role).toBe("operator");
  });
});
