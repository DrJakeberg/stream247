import { beforeEach, describe, expect, it, vi } from "vitest";

// M69 (2.1): the bot-account connect, same harness as twitch-broadcaster-connect-api.test.ts.
// The routes run for real here — including lib/server/twitch and lib/server/oauth-state — with
// only the process edges replaced: the session check, the persistence layer, the Next.js cookie
// store, and Twitch's token/user endpoints. That way the tests cover the part that matters and
// cannot be exercised against the real broadcaster account today: state validation, the
// wrong-account rejection, and what exactly lands in the broadcaster slot.

const {
  mockRequireApiRoles,
  mockAppendAuditEvent,
  mockReadAppState,
  mockUpdateBroadcasterRecord,
  mockUpdateTwitchConnectionRecord,
  cookieJar
} = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockReadAppState: vi.fn(),
  mockUpdateBroadcasterRecord: vi.fn(),
  mockUpdateTwitchConnectionRecord: vi.fn(),
  cookieJar: new Map<string, { value: string; options: Record<string, unknown> }>()
}));

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles
}));

// The real oauth-state machine runs; only its request-scoped adapter is replaced, because
// cookies() cannot be called outside a Next.js request scope. The jar stays inspectable so the
// tests can assert cookie names and flags.
vi.mock("@/lib/server/oauth-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/lib/server/oauth-state")>();
  const store = {
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)!.value } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieJar.set(name, { value, options });
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    }
  };

  return {
    ...actual,
    issueOAuthState: async (kind: Parameters<typeof actual.issueOAuthStateIn>[1]) =>
      actual.issueOAuthStateIn(store, kind),
    consumeOAuthState: async (kind: Parameters<typeof actual.consumeOAuthStateIn>[1], presented: string | null) =>
      actual.consumeOAuthStateIn(store, kind, presented)
  };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" }
      });
    },
    redirect(url: string | URL) {
      return new Response(null, { status: 307, headers: { location: String(url) } });
    }
  }
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  findTeamGrantByLogin: vi.fn(),
  getManagedTwitchConfig: (state: { managedConfig: Record<string, string> }) => ({
    clientId: state.managedConfig.twitchClientId,
    clientSecret: state.managedConfig.twitchClientSecret,
    defaultCategoryId: state.managedConfig.twitchDefaultCategoryId,
    broadcastChannelLogin: state.managedConfig.twitchBroadcastChannelLogin,
    botLogin: state.managedConfig.twitchBotLogin ?? ""
  }),
  readAppState: mockReadAppState,
  updateTwitchBroadcasterConnectionRecord: mockUpdateBroadcasterRecord,
  updateTwitchConnectionRecord: mockUpdateTwitchConnectionRecord,
  upsertUserRecord: vi.fn()
}));

import { GET as startBotConnect } from "../../apps/web/app/api/integrations/twitch/connect/route";
import { GET as botCallback } from "../../apps/web/app/api/integrations/twitch/callback/route";

function baseState(overrides: { botLogin?: string; channel?: string; twitch?: Record<string, string> } = {}) {
  return {
    appUrl: "",
    managedConfig: {
      appUrl: "http://localhost:3000",
      twitchClientId: "client-id",
      twitchClientSecret: "client-secret",
      twitchDefaultCategoryId: "",
      twitchBotLogin: overrides.botLogin ?? "",
      twitchBroadcastChannelLogin: overrides.channel ?? "jimpanse247"
    },
    twitch: overrides.twitch ?? { status: "connected", broadcasterId: "id-3jakec", broadcasterLogin: "3jakec" },
    twitchBroadcaster: { status: "not-connected", broadcasterId: "", broadcasterLogin: "", accessToken: "" }
  };
}

const fetchMock = vi.fn();

function stubTwitchEndpoints(login: string) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
      return Response.json({ access_token: `access-${login}`, refresh_token: "refresh", expires_in: 3600 });
    }
    if (url.startsWith("https://id.twitch.tv/oauth2/revoke")) {
      return new Response(null, { status: 200 });
    }
    if (url.startsWith("https://api.twitch.tv/helix/users")) {
      return Response.json({ data: [{ id: `id-${login}`, login, display_name: login }] });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
}

async function connectAs(login: string) {
  stubTwitchEndpoints(login);
  const start = await startBotConnect();
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
  const url = new URL("http://localhost:3000/api/integrations/twitch/callback");
  url.searchParams.set("code", "code-1");
  url.searchParams.set("state", state);
  return botCallback({ nextUrl: url } as never);
}

function revokeCalls() {
  return fetchMock.mock.calls.filter(([input]) => String(input).startsWith("https://id.twitch.tv/oauth2/revoke"));
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  vi.stubGlobal("fetch", fetchMock);
  mockRequireApiRoles.mockResolvedValue(null);
  mockAppendAuditEvent.mockResolvedValue(undefined);
  mockUpdateTwitchConnectionRecord.mockResolvedValue(undefined);
  mockReadAppState.mockResolvedValue(baseState());
});

describe("connecting the bot account", () => {
  it("makes Twitch show which account signs in", async () => {
    const response = await startBotConnect();
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("force_verify")).toBe("true");
  });

  it("stores the bot account and names it as the bot in the audit trail", async () => {
    await connectAs("3jakec");
    expect(mockUpdateTwitchConnectionRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "connected", broadcasterLogin: "3jakec", broadcasterId: "id-3jakec" })
    );
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("twitch.connected", "Connected the Twitch bot account 3jakec (id-3jakec).");
    expect(revokeCalls()).toHaveLength(0);
  });

  it("refuses another account than the configured bot login: nothing stored, token revoked, reason audited", async () => {
    mockReadAppState.mockResolvedValue(baseState({ botLogin: "3JakeC" }));
    await connectAs("someoneelse");
    expect(mockUpdateTwitchConnectionRecord).not.toHaveBeenCalled();
    expect(revokeCalls()).toHaveLength(1);
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("twitch.bot.rejected", expect.stringMatching(/someoneelse.*3JakeC/));
    // Recorded once, as the rejection -- not a second time as a generic twitch.error.
    expect(mockAppendAuditEvent.mock.calls.filter(([type]) => type === "twitch.error")).toHaveLength(0);
  });

  // The browser is often signed in as the channel while the bot is being connected.
  it("refuses the broadcast channel itself while a split is active", async () => {
    await connectAs("jimpanse247");
    expect(mockUpdateTwitchConnectionRecord).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("twitch.bot.rejected", expect.stringContaining("broadcast channel itself"));
  });

  it("lets a fresh install connect the channel as its single account", async () => {
    mockReadAppState.mockResolvedValue(baseState({ twitch: { status: "not-connected", broadcasterId: "", broadcasterLogin: "" } }));
    await connectAs("jimpanse247");
    expect(mockUpdateTwitchConnectionRecord).toHaveBeenCalledWith(expect.objectContaining({ broadcasterLogin: "jimpanse247" }));
  });
});
