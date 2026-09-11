import { beforeEach, describe, expect, it, vi } from "vitest";

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
    broadcastChannelLogin: state.managedConfig.twitchBroadcastChannelLogin
  }),
  readAppState: mockReadAppState,
  updateTwitchBroadcasterConnectionRecord: mockUpdateBroadcasterRecord,
  updateTwitchConnectionRecord: mockUpdateTwitchConnectionRecord,
  upsertUserRecord: vi.fn()
}));

import { GET as startBroadcasterConnect } from "../../apps/web/app/api/integrations/twitch/connect-broadcaster/route";
import { GET as broadcasterCallback } from "../../apps/web/app/api/integrations/twitch/callback-broadcaster/route";
import { POST as disconnectBroadcaster } from "../../apps/web/app/api/integrations/twitch/disconnect-broadcaster/route";

const BROADCASTER_STATE_COOKIE = "s247_oauth_state_broadcast_channel";
const IDENTITY_STATE_COOKIE = "s247_oauth_state_connect";

function emptyBroadcasterSlot() {
  return {
    status: "not-connected",
    broadcasterId: "",
    broadcasterLogin: "",
    accessToken: "",
    refreshToken: "",
    connectedAt: "",
    tokenExpiresAt: "",
    lastRefreshAt: "",
    error: ""
  };
}

function baseState(overrides: { broadcastChannelLogin?: string; twitchBroadcaster?: Record<string, string> } = {}) {
  return {
    managedConfig: {
      twitchClientId: "client-id",
      twitchClientSecret: "client-secret",
      twitchDefaultCategoryId: "",
      twitchBroadcastChannelLogin: overrides.broadcastChannelLogin ?? "jimpanse247"
    },
    twitch: { status: "connected", broadcasterId: "id-3jakec", broadcasterLogin: "3jakec" },
    twitchBroadcaster: overrides.twitchBroadcaster ?? emptyBroadcasterSlot()
  };
}

const fetchMock = vi.fn();

/** Twitch's two endpoints, keyed by URL; `login` is who the authorisation ends up belonging to. */
function stubTwitchEndpoints(login: string) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
      return Response.json({ access_token: "slot-access", refresh_token: "slot-refresh", expires_in: 3600 });
    }
    if (url.startsWith("https://api.twitch.tv/helix/users")) {
      return Response.json({ data: [{ id: `id-${login}`, login, display_name: login }] });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
}

/** Runs the start route and returns the state token Twitch would echo back. */
async function startFlowAndReadState(): Promise<string> {
  const response = await startBroadcasterConnect();
  expect(response.status).toBe(307);
  const authorizeUrl = new URL(response.headers.get("location") ?? "");
  return authorizeUrl.searchParams.get("state") ?? "";
}

function callbackRequest(params: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/integrations/twitch/callback-broadcaster");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return { nextUrl: url } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  vi.stubGlobal("fetch", fetchMock);
  mockRequireApiRoles.mockResolvedValue(null);
  mockAppendAuditEvent.mockResolvedValue(undefined);
  mockUpdateBroadcasterRecord.mockResolvedValue(undefined);
  mockReadAppState.mockResolvedValue(baseState());
});

describe("the broadcaster-slot start route", () => {
  it("requests only the two metadata scopes and its own callback", async () => {
    const response = await startBroadcasterConnect();

    expect(response.status).toBe(307);
    const authorizeUrl = new URL(response.headers.get("location") ?? "");
    expect(authorizeUrl.origin).toBe("https://id.twitch.tv");
    expect(authorizeUrl.searchParams.get("scope")).toBe("channel:manage:broadcast channel:manage:schedule");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toContain("/api/integrations/twitch/callback-broadcaster");
  });

  it("binds the flow to a state cookie namespaced apart from the identity flow's", async () => {
    const state = await startFlowAndReadState();

    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(cookieJar.get(BROADCASTER_STATE_COOKIE)?.value).toBe(state);
    expect(cookieJar.has(IDENTITY_STATE_COOKIE)).toBe(false);
    // Same security bar as the identity flow: the cookie must not be readable or sent cross-site.
    expect(cookieJar.get(BROADCASTER_STATE_COOKIE)?.options).toMatchObject({ httpOnly: true, sameSite: "lax" });
  });

  it("refuses to start without a broadcast channel split", async () => {
    mockReadAppState.mockResolvedValue(baseState({ broadcastChannelLogin: "" }));

    const response = await startBroadcasterConnect();

    expect(response.status).toBe(400);
    expect(cookieJar.size).toBe(0);
  });

  it("refuses to start when the broadcast channel equals the identity — that is not a split", async () => {
    mockReadAppState.mockResolvedValue(baseState({ broadcastChannelLogin: "3jakec" }));

    const response = await startBroadcasterConnect();

    expect(response.status).toBe(400);
  });

  it("requires an owner or admin session", async () => {
    mockRequireApiRoles.mockResolvedValue(new Response(null, { status: 401 }));

    const response = await startBroadcasterConnect();

    expect(response.status).toBe(401);
    expect(cookieJar.size).toBe(0);
  });
});

describe("the broadcaster-slot callback", () => {
  it("stores the tokens in the broadcaster slot when the right account connects", async () => {
    stubTwitchEndpoints("jimpanse247");
    const state = await startFlowAndReadState();

    const response = await broadcasterCallback(callbackRequest({ code: "auth-code", state }));

    expect(response.status).toBe(307);
    expect(mockUpdateBroadcasterRecord).toHaveBeenCalledTimes(1);
    expect(mockUpdateBroadcasterRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "connected",
        broadcasterId: "id-jimpanse247",
        broadcasterLogin: "jimpanse247",
        accessToken: "slot-access",
        refreshToken: "slot-refresh"
      })
    );
    // The identity slot stays untouched — the corruption the separate flow exists to prevent.
    expect(mockUpdateTwitchConnectionRecord).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("twitch.broadcaster.connected", expect.stringContaining("jimpanse247"));
  });

  it("accepts a case-different login for the same channel", async () => {
    stubTwitchEndpoints("Jimpanse247");
    const state = await startFlowAndReadState();

    await broadcasterCallback(callbackRequest({ code: "auth-code", state }));

    expect(mockUpdateBroadcasterRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "connected" }));
  });

  it("rejects the identity account and stores no token", async () => {
    // The likeliest mistake: the operator is signed in to Twitch as the moderator identity and
    // clicks through the consent screen. The slot must stay empty and the message must name both
    // accounts so the operator knows which sign-in to redo.
    stubTwitchEndpoints("3jakec");
    const state = await startFlowAndReadState();

    await broadcasterCallback(callbackRequest({ code: "auth-code", state }));

    expect(mockUpdateBroadcasterRecord).not.toHaveBeenCalledWith(expect.objectContaining({ status: "connected" }));
    expect(mockUpdateBroadcasterRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: expect.stringContaining("3jakec") })
    );
    expect(mockUpdateBroadcasterRecord).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("jimpanse247") })
    );
  });

  it("keeps a working broadcaster connection when a later attempt picks the wrong account", async () => {
    mockReadAppState.mockResolvedValue(
      baseState({
        twitchBroadcaster: { ...emptyBroadcasterSlot(), status: "connected", broadcasterLogin: "jimpanse247", accessToken: "good" }
      })
    );
    stubTwitchEndpoints("3jakec");
    const state = await startFlowAndReadState();

    await broadcasterCallback(callbackRequest({ code: "auth-code", state }));

    // The rejection is audited but the connected slot record is never rewritten.
    expect(mockUpdateBroadcasterRecord).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("twitch.broadcaster.error", expect.stringContaining("3jakec"));
  });

  it("rejects a forged state before any Twitch call happens", async () => {
    stubTwitchEndpoints("jimpanse247");
    await startFlowAndReadState();

    await broadcasterCallback(callbackRequest({ code: "attacker-code", state: "forged-state-value" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpdateBroadcasterRecord).not.toHaveBeenCalledWith(expect.objectContaining({ status: "connected" }));
  });

  it("consumes the state cookie even when the caller is not signed in", async () => {
    const state = await startFlowAndReadState();
    mockRequireApiRoles.mockResolvedValue(new Response(null, { status: 401 }));

    const response = await broadcasterCallback(callbackRequest({ code: "auth-code", state }));

    expect(response.status).toBe(401);
    // Single-use: the denied attempt must not leave a replayable cookie behind.
    expect(cookieJar.has(BROADCASTER_STATE_COOKIE)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the broadcaster-slot disconnect", () => {
  it("clears the slot and audits which account was dropped", async () => {
    mockReadAppState.mockResolvedValue(
      baseState({
        twitchBroadcaster: { ...emptyBroadcasterSlot(), status: "connected", broadcasterLogin: "jimpanse247", accessToken: "good" }
      })
    );

    const response = await disconnectBroadcaster();

    expect(response.status).toBe(200);
    expect(mockUpdateBroadcasterRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "not-connected", accessToken: "", refreshToken: "", broadcasterLogin: "" })
    );
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("twitch.broadcaster.disconnected", expect.stringContaining("jimpanse247"));
  });

  it("requires an owner or admin session", async () => {
    mockRequireApiRoles.mockResolvedValue(new Response(null, { status: 403 }));

    const response = await disconnectBroadcaster();

    expect(response.status).toBe(403);
    expect(mockUpdateBroadcasterRecord).not.toHaveBeenCalled();
  });
});
