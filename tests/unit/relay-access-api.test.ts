import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireApiRoles,
  mockGetAuthenticatedUser,
  mockAppendAuditEvent,
  mockReadRelayInternalKey,
  mockReadRelayInternalKeyIfPresent
} = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockGetAuthenticatedUser: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockReadRelayInternalKey: vi.fn(),
  mockReadRelayInternalKeyIfPresent: vi.fn()
}));

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles,
  getAuthenticatedUser: mockGetAuthenticatedUser
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent
}));

// Both readers are exposed, so "the route never calls the self-generating one" is an assertion
// rather than an assumption. readRelayInternalKey is the only code path in the repo that can INSERT
// or UPDATE the stored key, so never calling it IS the non-write proof at this level; the
// row-count and ciphertext proofs live in tests/integration/db-roundtrip.test.ts.
vi.mock("@stream247/db", () => ({
  readRelayInternalKey: mockReadRelayInternalKey,
  readRelayInternalKeyIfPresent: mockReadRelayInternalKeyIfPresent
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json", ...((init?.headers as Record<string, string>) ?? {}) }
      });
    }
  }
}));

import { POST } from "../../apps/web/app/api/settings/relay-access/route";
import { clearAllRateLimits, RELAY_ACCESS_REVEAL_RATE_LIMIT } from "../../apps/web/lib/server/rate-limit";

// M57 stage 2, Etappe E. The one surface that hands an operator the internal relay key, so the
// gate around it is the feature: owner/admin only, one deliberate action rather than page render,
// a named actor in the audit trail, and a limit so a stolen session cannot mine it in a loop.

const INTERNAL_KEY = "internal-key-eeeeeeeeeeeeeeeeeeee";

// The handler takes no request on purpose: it has nothing to read from one, and a body it does not
// parse is a body it cannot be steered by. Identity comes from the session, never from the caller.

beforeEach(() => {
  vi.clearAllMocks();
  clearAllRateLimits();
  mockRequireApiRoles.mockResolvedValue(null);
  mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1", email: "owner@example.com", role: "owner" });
  mockReadRelayInternalKeyIfPresent.mockResolvedValue(INTERNAL_KEY);
  // Deliberately made to throw: nothing in this route may reach the self-generating reader, and a
  // test that only checked "not called" would still pass if a future edit called it in a branch
  // these cases do not cover.
  mockReadRelayInternalKey.mockRejectedValue(new Error("the reveal route must never generate a key"));
});

describe("revealing the relay rollback lines", () => {
  it("refuses anyone the role check turns away, without touching the key", async () => {
    mockRequireApiRoles.mockResolvedValue(new Response(null, { status: 403 }));

    const response = await POST();

    expect(response.status).toBe(403);
    expect(mockReadRelayInternalKeyIfPresent).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });

  it("asks for owner or admin, never a wider set", async () => {
    await POST();
    expect(mockRequireApiRoles).toHaveBeenCalledWith(["owner", "admin"]);
  });

  it("only ever LOOKS at the key — it can neither create nor replace one", async () => {
    await POST();

    expect(mockReadRelayInternalKeyIfPresent).toHaveBeenCalledTimes(1);
    // The self-generating reader is the only path in the repo that INSERTs or UPDATEs the stored
    // key. A reveal that touched it would mint or overwrite a value no running container holds, and
    // every relay read and publish would fail until each one restarted.
    expect(mockReadRelayInternalKey).not.toHaveBeenCalled();
  });

  it("refuses when the session can no longer be named, without handing anything over", async () => {
    // Deleted or demoted between the role check and this read. Carrying on would reveal the key
    // against an unnamed audit line and collapse every such caller into one rate-limit bucket.
    mockGetAuthenticatedUser.mockResolvedValue(null);

    const response = await POST();
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(body).not.toContain(INTERNAL_KEY);
    expect(mockReadRelayInternalKeyIfPresent).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });

  it("hands back both lines with the key embedded", async () => {
    const response = await POST();
    const payload = (await response.json()) as { ok: boolean; lines: string[] };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.lines).toHaveLength(2);
    for (const line of payload.lines) {
      expect(line).toContain(INTERNAL_KEY);
    }
  });

  it("keeps the answer out of every cache on the way back", async () => {
    const response = await POST();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("writes one audit line naming who asked, and never the key itself", async () => {
    await POST();

    expect(mockAppendAuditEvent).toHaveBeenCalledTimes(1);
    const [type, message] = mockAppendAuditEvent.mock.calls[0] as [string, string];
    expect(type).toBe("relay.internal_key.revealed");
    expect(message).toContain("owner@example.com");
    expect(message).not.toContain(INTERNAL_KEY);
  });

  it("stops a session that asks over and over, and still leaves no key in the refusal", async () => {
    for (let attempt = 0; attempt < RELAY_ACCESS_REVEAL_RATE_LIMIT.limit; attempt += 1) {
      expect((await POST()).status).toBe(200);
    }

    const response = await POST();
    const body = await response.text();

    expect(response.status).toBe(429);
    expect(body).not.toContain(INTERNAL_KEY);
    // The limited attempt must not buy an extra audit line either.
    expect(mockAppendAuditEvent).toHaveBeenCalledTimes(RELAY_ACCESS_REVEAL_RATE_LIMIT.limit);
  });

  it("refuses rather than minting a key when none is stored, and answers the same way when one cannot be read", async () => {
    // A real branch, not dead code: the peek returns "" both on an install that has no key yet and
    // on one whose stored row this APP_SECRET can no longer decrypt. Neither may be answered by
    // generating a fresh key, and neither is distinguished to the caller.
    for (const _case of ["no key stored", "key unreadable"]) {
      mockReadRelayInternalKeyIfPresent.mockResolvedValue("");
      clearAllRateLimits();

      const response = await POST();
      const payload = (await response.json()) as { ok: boolean; lines?: string[]; message?: string };

      expect(response.status).toBe(503);
      expect(payload.ok).toBe(false);
      expect(payload.lines).toBeUndefined();
      expect(mockReadRelayInternalKey).not.toHaveBeenCalled();
      expect(mockAppendAuditEvent).not.toHaveBeenCalled();
    }
  });

  it("says nothing about the key when the store is unreachable", async () => {
    mockReadRelayInternalKeyIfPresent.mockRejectedValue(
      new Error(`connect ECONNREFUSED while holding ${INTERNAL_KEY}`)
    );

    const response = await POST();
    const body = await response.text();

    expect(response.status).toBe(503);
    // An error message is a place a credential leaks from; this one must carry none of it.
    expect(body).not.toContain(INTERNAL_KEY);
    expect(body).not.toContain("ECONNREFUSED");
  });
});
