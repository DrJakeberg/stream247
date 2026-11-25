import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M127, the routes an anonymous caller reaches before any session check.
 *
 * Bodies: every one of them read the whole request body (request.json() or request.text()) before its
 * rate limit, its state read or its signature check, with nothing capping the size. They now read
 * through a bounded reader and refuse an oversized body before anything else runs.
 *
 * First run: two overlapping bootstrap requests both passed the "not initialized yet" read and both
 * wrote an owner. The claim is now one guarded write, and the loser gets 409 with nothing written.
 */
const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  upsertUserRecord: vi.fn(),
  appendAuditEvent: vi.fn(),
  appendEngagementEventRecord: vi.fn(),
  updateManagedConfigRecord: vi.fn(),
  updateOwnerAndInitialized: vi.fn(),
  claimOwnerAndInitialize: vi.fn(),
  setSessionCookie: vi.fn(),
  readRelayCredentials: vi.fn(),
  consumeRateLimit: vi.fn()
}));

vi.mock("@stream247/db", () => ({ MIN_OWNER_PASSWORD_LENGTH: 12 }));
vi.mock("@/lib/server/state", () => ({
  readAppState: mocks.readAppState,
  findUserByEmail: mocks.findUserByEmail,
  findUserById: mocks.findUserById,
  upsertUserRecord: mocks.upsertUserRecord,
  appendAuditEvent: mocks.appendAuditEvent,
  appendEngagementEventRecord: mocks.appendEngagementEventRecord,
  updateManagedConfigRecord: mocks.updateManagedConfigRecord,
  updateOwnerAndInitialized: mocks.updateOwnerAndInitialized,
  claimOwnerAndInitialize: mocks.claimOwnerAndInitialize
}));
vi.mock("@/lib/server/auth", () => ({
  buildTwoFactorChallengeValue: () => "challenge",
  parseTwoFactorChallengeValue: () => ({ userId: "user_owner" }),
  hashPassword: () => "hash",
  sessionPasswordHash: () => "hash",
  setSessionCookie: mocks.setSessionCookie,
  verifyPassword: () => false
}));
vi.mock("@/lib/server/two-factor", () => ({ verifyTotpCode: () => false }));
vi.mock("@/lib/server/relay-credentials", () => ({ readRelayCredentials: mocks.readRelayCredentials }));
vi.mock("@/lib/server/rate-limit", () => ({
  LOGIN_RATE_LIMIT: { limit: 5, windowMs: 60_000 },
  TWO_FACTOR_RATE_LIMIT: { limit: 5, windowMs: 60_000 },
  RELAY_AUTH_RATE_LIMIT: { limit: 5, windowMs: 60_000 },
  consumeRateLimit: mocks.consumeRateLimit,
  getClientIdentifier: () => "test",
  resetRateLimit: () => undefined
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) }
      });
    }
  }
}));

import { POST as login } from "../../apps/web/app/api/auth/login/route";
import { POST as loginTwoFactor } from "../../apps/web/app/api/auth/login/2fa/route";
import { POST as bootstrap } from "../../apps/web/app/api/setup/bootstrap/route";
import { POST as relayAuth } from "../../apps/web/app/api/relay/auth/route";
import { POST as eventSub } from "../../apps/web/app/api/overlay/events/route";
import { PREAUTH_BODY_LIMIT_BYTES, readBoundedText } from "../../apps/web/lib/server/bounded-body";

const padding = (bytes: number) => "x".repeat(bytes);

function jsonRequest(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): never {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  }) as never;
}

const emptyState = {
  initialized: false,
  owner: null,
  users: [],
  managedConfig: { twitchClientId: "", twitchClientSecret: "" }
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  mocks.readAppState.mockResolvedValue(emptyState);
  mocks.consumeRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0, remaining: 4 });
  mocks.readRelayCredentials.mockResolvedValue({ sources: [], internalKey: "internal-key" });
});

describe("M127: pre-authentication routes cap the request body", () => {
  it("sign-in refuses a 20 KiB body with 413 before the rate limit or the state read", async () => {
    const response = await login(jsonRequest("/api/auth/login", { email: "a@b.c", password: "pw", pad: padding(20 * 1024) }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ message: "The request is too large." });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.readAppState).not.toHaveBeenCalled();
  });

  it("sign-in still answers an ordinary body as before", async () => {
    const response = await login(jsonRequest("/api/auth/login", { email: "a@b.c", password: "pw" }));
    expect(response.status).toBe(401);
    expect(mocks.readAppState).toHaveBeenCalledTimes(1);
  });

  it("the one-time-code step refuses a 20 KiB body with 413 before the rate limit or the state read", async () => {
    const response = await loginTwoFactor(
      jsonRequest("/api/auth/login/2fa", { challengeToken: "c", code: "123456", pad: padding(20 * 1024) })
    );

    expect(response.status).toBe(413);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.readAppState).not.toHaveBeenCalled();
  });

  it("first-run setup refuses a 20 KiB body with 413 before the state read", async () => {
    const response = await bootstrap(
      jsonRequest("/api/setup/bootstrap", { email: "owner@example.com", password: "long-enough-password", pad: padding(20 * 1024) })
    );

    expect(response.status).toBe(413);
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.claimOwnerAndInitialize).not.toHaveBeenCalled();
  });

  it("relay auth refuses a 20 KiB body with its bare 403 and never reads the credentials", async () => {
    const response = await relayAuth(
      new Request("http://web:3000/api/relay/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "", password: padding(20 * 1024), path: "live", action: "publish" })
      })
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
    expect(mocks.readRelayCredentials).not.toHaveBeenCalled();
  });

  it("relay auth refuses a declared Content-Length above the limit without reading the stream", async () => {
    const response = await relayAuth(
      new Request("http://web:3000/api/relay/auth", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(16 * 1024 + 1) },
        body: "{}"
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.readRelayCredentials).not.toHaveBeenCalled();
  });

  it("the EventSub callback refuses a 70 KiB body with 413 before the state read and the signature check", async () => {
    const response = await eventSub(
      new Request("http://localhost/api/overlay/events", {
        method: "POST",
        headers: { "content-type": "application/json", "twitch-eventsub-message-type": "notification" },
        body: JSON.stringify({ subscription: { type: "channel.follow" }, pad: padding(70 * 1024) })
      })
    );

    expect(response.status).toBe(413);
    expect(mocks.readAppState).not.toHaveBeenCalled();
  });
});

describe("M127: the first-run owner claim is one guarded write", () => {
  const body = { email: "late@example.com", password: "long-enough-password" };

  it("answers 409 and writes nothing else when another request claimed the workspace first", async () => {
    mocks.claimOwnerAndInitialize.mockResolvedValue(false);

    const response = await bootstrap(jsonRequest("/api/setup/bootstrap", { ...body, twitchClientId: "client" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: "Workspace has already been initialized." });
    expect(mocks.claimOwnerAndInitialize).toHaveBeenCalledTimes(1);
    expect(mocks.updateOwnerAndInitialized).not.toHaveBeenCalled();
    expect(mocks.upsertUserRecord).not.toHaveBeenCalled();
    expect(mocks.updateManagedConfigRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it("signs the winner in after the claim", async () => {
    mocks.claimOwnerAndInitialize.mockResolvedValue(true);
    mocks.readAppState
      .mockResolvedValueOnce(emptyState)
      .mockResolvedValueOnce({ ...emptyState, initialized: true, users: [{ id: "user_x", email: body.email }] });

    const response = await bootstrap(jsonRequest("/api/setup/bootstrap", body));

    expect(response.status).toBe(200);
    const [owner, ownerUser] = mocks.claimOwnerAndInitialize.mock.calls[0];
    expect(owner).toMatchObject({ email: body.email, passwordHash: "hash" });
    expect(ownerUser).toMatchObject({ email: body.email, role: "owner", authProvider: "local", passwordHash: "hash" });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith("setup.completed", `Workspace initialized by ${body.email}.`);
    expect(mocks.setSessionCookie).toHaveBeenCalledWith("user_x", "hash");
  });
});

describe("M127: readBoundedText", () => {
  function streamOf(chunks: number, chunkBytes: number) {
    let sent = 0;
    const state = { cancelled: false, pulled: 0 };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= chunks) {
          controller.close();
          return;
        }
        sent += 1;
        state.pulled += 1;
        controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
      },
      cancel() {
        state.cancelled = true;
      }
    });
    return { stream, state };
  }

  it("refuses a declared Content-Length one byte above the limit without reading the body", async () => {
    const { stream, state } = streamOf(1, 10);
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-length": String(PREAUTH_BODY_LIMIT_BYTES + 1) },
      body: stream,
      duplex: "half"
    } as RequestInit);

    expect(await readBoundedText(request, PREAUTH_BODY_LIMIT_BYTES)).toBeNull();
    expect(state.pulled).toBeLessThanOrEqual(1);
  });

  it("cuts off a 20 KiB stream without a length and cancels it", async () => {
    const { stream, state } = streamOf(20, 1024);
    const request = new Request("http://localhost/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);

    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBoundedText(request, PREAUTH_BODY_LIMIT_BYTES)).toBeNull();
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(20);
  });

  it("returns a body of exactly the limit as text, and an empty body as an empty string", async () => {
    const exact = new Request("http://localhost/x", { method: "POST", body: "a".repeat(PREAUTH_BODY_LIMIT_BYTES) });
    expect(await readBoundedText(exact, PREAUTH_BODY_LIMIT_BYTES)).toBe("a".repeat(PREAUTH_BODY_LIMIT_BYTES));

    const multiByte = new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ name: "Grüße ✓" }) });
    expect(await readBoundedText(multiByte, PREAUTH_BODY_LIMIT_BYTES)).toBe('{"name":"Grüße ✓"}');

    expect(await readBoundedText(new Request("http://localhost/x", { method: "POST" }), PREAUTH_BODY_LIMIT_BYTES)).toBe("");
  });
});
