import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeOAuthStateIn,
  createOAuthStateToken,
  describeOAuthStateFailure,
  issueOAuthStateIn,
  matchesOAuthState,
  type OAuthCookieStore
} from "../../apps/web/lib/server/oauth-state.js";

// Stand-in for the Next.js cookie store: the state machine is exercised directly, without a
// request scope.
function createCookieStore(): OAuthCookieStore & { jar: Map<string, string> } {
  const jar = new Map<string, string>();
  return {
    jar,
    get: (name) => (jar.has(name) ? { value: jar.get(name) as string } : undefined),
    set: (name, value) => {
      jar.set(name, value);
    },
    delete: (name) => {
      jar.delete(name);
    }
  };
}

let store = createCookieStore();

beforeEach(() => {
  store = createCookieStore();
});

const issueOAuthState = async (kind: "broadcaster-connect" | "team-login") => issueOAuthStateIn(store, kind);
const consumeOAuthState = async (kind: "broadcaster-connect" | "team-login", presented: string | null) =>
  consumeOAuthStateIn(store, kind, presented);

describe("createOAuthStateToken", () => {
  it("produces a high-entropy token", () => {
    const token = createOAuthStateToken();

    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createOAuthStateToken()));

    expect(tokens.size).toBe(200);
  });
});

describe("matchesOAuthState", () => {
  it("accepts an exact match", () => {
    expect(matchesOAuthState("abc123", "abc123")).toBe(true);
  });

  it("rejects a different value, a prefix, and an empty pair", () => {
    expect(matchesOAuthState("abc123", "abc124")).toBe(false);
    expect(matchesOAuthState("abc123", "abc")).toBe(false);
    expect(matchesOAuthState("", "")).toBe(false);
  });
});

describe("issueOAuthState / consumeOAuthState", () => {
  it("accepts the token it issued", async () => {
    const token = await issueOAuthState("broadcaster-connect");

    await expect(consumeOAuthState("broadcaster-connect", token)).resolves.toEqual({ ok: true });
  });

  it("rejects a callback that presents no state at all", async () => {
    await issueOAuthState("broadcaster-connect");

    await expect(consumeOAuthState("broadcaster-connect", null)).resolves.toEqual({
      ok: false,
      reason: "missing-state"
    });
  });

  it("rejects an attacker-supplied state when no flow was started", async () => {
    // The takeover shape: an attacker drives the callback directly, without ever visiting the
    // workspace, so no state cookie exists in their browser.
    await expect(consumeOAuthState("broadcaster-connect", "attacker-controlled-value")).resolves.toEqual({
      ok: false,
      reason: "missing-cookie"
    });
  });

  it("rejects a state that does not match the issued one", async () => {
    await issueOAuthState("broadcaster-connect");

    await expect(consumeOAuthState("broadcaster-connect", createOAuthStateToken())).resolves.toEqual({
      ok: false,
      reason: "mismatch"
    });
  });

  it("is single-use: a replayed token is rejected", async () => {
    const token = await issueOAuthState("broadcaster-connect");
    await consumeOAuthState("broadcaster-connect", token);

    await expect(consumeOAuthState("broadcaster-connect", token)).resolves.toEqual({
      ok: false,
      reason: "missing-cookie"
    });
  });

  it("clears the cookie even when verification fails, so it cannot be brute-forced", async () => {
    const token = await issueOAuthState("broadcaster-connect");
    await consumeOAuthState("broadcaster-connect", "wrong");

    await expect(consumeOAuthState("broadcaster-connect", token)).resolves.toEqual({
      ok: false,
      reason: "missing-cookie"
    });
  });

  it("scopes state per flow: a team-login token cannot satisfy broadcaster-connect", async () => {
    const loginToken = await issueOAuthState("team-login");

    await expect(consumeOAuthState("broadcaster-connect", loginToken)).resolves.toEqual({
      ok: false,
      reason: "missing-cookie"
    });
  });

  it("keeps the two flows independent", async () => {
    const connectToken = await issueOAuthState("broadcaster-connect");
    const loginToken = await issueOAuthState("team-login");

    await expect(consumeOAuthState("team-login", loginToken)).resolves.toEqual({ ok: true });
    await expect(consumeOAuthState("broadcaster-connect", connectToken)).resolves.toEqual({ ok: true });
  });
});

describe("describeOAuthStateFailure", () => {
  it("explains every rejection reason without leaking the expected token", () => {
    for (const reason of ["missing-state", "missing-cookie", "mismatch"] as const) {
      const message = describeOAuthStateFailure(reason);
      expect(message.length).toBeGreaterThan(20);
    }
  });
});
