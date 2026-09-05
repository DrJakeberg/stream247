import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAppendAuditEvent, mockReadCredentials, mockReadRelayInternalKey } = vi.hoisted(() => ({
  mockAppendAuditEvent: vi.fn(),
  mockReadCredentials: vi.fn(),
  mockReadRelayInternalKey: vi.fn()
}));

vi.mock("@stream247/db", () => ({
  readOverlayVideoSourceIngestCredentials: mockReadCredentials,
  readRelayInternalKey: mockReadRelayInternalKey
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" }
      });
    }
  }
}));

import { POST } from "../../apps/web/app/api/relay/auth/route";
import { clearAllRateLimits, RELAY_AUTH_RATE_LIMIT } from "../../apps/web/lib/server/rate-limit";
import { clearRelayAuditThrottleForTests } from "../../apps/web/lib/server/relay-audit-throttle";

// The endpoint mediamtx asks about every publish and read. It carries no session — the relay
// calls it server-side, and the credential under test IS the request body — which is exactly why
// its failure answers must all look the same: a bare 403, no reason, no body.

const PUBLISH_KEY = "push-key-cccccccccccccccccccccccc";
const INTERNAL_KEY = "internal-key-dddddddddddddddddddd";

// `forwardedFor` is the ONLY way to vary the transport peer the endpoint keys on — the `ip`
// field lives in the body an attacker controls, so it must never move the rate-limit bucket.
function relayBody(overrides: Record<string, unknown>, options?: { forwardedFor?: string }): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options?.forwardedFor) {
    headers["x-forwarded-for"] = options.forwardedFor;
  }
  return new Request("http://web:3000/api/relay/auth", {
    method: "POST",
    headers,
    body: JSON.stringify({
      user: "",
      password: "",
      ip: "203.0.113.7",
      path: "",
      action: "publish",
      protocol: "rtmp",
      query: "",
      ...overrides
    })
  });
}

describe("relay auth endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllRateLimits();
    clearRelayAuditThrottleForTests();
    mockReadCredentials.mockResolvedValue([{ id: "studio-cam", ingestKind: "push", publishKey: PUBLISH_KEY }]);
    mockReadRelayInternalKey.mockResolvedValue(INTERNAL_KEY);
  });

  it("allows a publish with the source's publish key", async () => {
    const response = await POST(relayBody({ path: "src-studio-cam", password: PUBLISH_KEY }));
    expect(response.status).toBe(200);
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });

  it("allows internal reads and the rollback publish with the internal key", async () => {
    expect((await POST(relayBody({ action: "read", path: "src-studio-cam", password: INTERNAL_KEY }))).status).toBe(200);
    expect((await POST(relayBody({ path: "live/program", password: INTERNAL_KEY }))).status).toBe(200);
  });

  it("denies a bad publish with a bare 403 and writes one audit line without the credential", async () => {
    const response = await POST(relayBody({ path: "src-studio-cam", password: "wrong-key-value" }));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");

    expect(mockAppendAuditEvent).toHaveBeenCalledTimes(1);
    const [type, message] = mockAppendAuditEvent.mock.calls[0] as [string, string];
    expect(type).toBe("relay.publish_rejected");
    expect(message).toContain("src-studio-cam");
    expect(message).not.toContain("wrong-key-value");
    expect(message).not.toContain(PUBLISH_KEY);
    expect(message).not.toContain(INTERNAL_KEY);
  });

  it("denies rejected reads without an audit line", async () => {
    const response = await POST(relayBody({ action: "read", path: "src-studio-cam", password: "wrong" }));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });

  it("denies a request that is not JSON", async () => {
    const response = await POST(
      new Request("http://web:3000/api/relay/auth", { method: "POST", body: "not json" })
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
  });

  it("denies a literal null (or non-object) JSON body with the same bare 403, never a 500", async () => {
    for (const raw of ["null", '"a string"', "42", "[1,2]"]) {
      const response = await POST(
        new Request("http://web:3000/api/relay/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: raw
        })
      );
      expect(response.status, raw).toBe(403);
      expect(await response.text()).toBe("");
    }
  });

  it("denies when the stores are unreachable, instead of failing open", async () => {
    mockReadRelayInternalKey.mockRejectedValue(new Error("database is down"));
    const response = await POST(relayBody({ action: "read", path: "src-studio-cam", password: INTERNAL_KEY }));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
  });

  it("rate limits on the transport peer, not the attacker-controlled body ip", async () => {
    // One real peer (a fixed X-Forwarded-For), rotating the body `ip` on every request exactly
    // the way an attacker would to dodge a body-keyed limit. Peer keying must still stop them —
    // even a valid key past the limit is refused.
    for (let attempt = 0; attempt < RELAY_AUTH_RATE_LIMIT.limit; attempt += 1) {
      await POST(
        relayBody({ path: "src-studio-cam", password: "wrong", ip: `10.0.0.${attempt}` }, { forwardedFor: "198.51.100.5" })
      );
    }
    const overLimit = await POST(
      relayBody({ path: "src-studio-cam", password: PUBLISH_KEY, ip: "10.0.0.250" }, { forwardedFor: "198.51.100.5" })
    );
    expect(overLimit.status).toBe(403);

    // A genuinely different peer is unaffected, even reusing a body ip the noisy peer sent — so
    // one attacker can never exhaust a legitimate publisher's bucket by putting its ip in the body.
    const otherPeer = await POST(
      relayBody({ path: "src-studio-cam", password: PUBLISH_KEY, ip: "10.0.0.1" }, { forwardedFor: "198.51.100.6" })
    );
    expect(otherPeer.status).toBe(200);
  });

  it("throttles rejected-publish audit writes so the trail and the write lock cannot be flooded", async () => {
    // Three rejected publishes on the same source, each from a distinct peer so the rate limit
    // never fires — only the audit throttle can hold the line here. One audit event, not three.
    await POST(relayBody({ path: "src-studio-cam", password: "wrong-1" }, { forwardedFor: "203.0.113.10" }));
    await POST(relayBody({ path: "src-studio-cam", password: "wrong-2" }, { forwardedFor: "203.0.113.11" }));
    await POST(relayBody({ path: "src-studio-cam", password: "wrong-3" }, { forwardedFor: "203.0.113.12" }));
    expect(mockAppendAuditEvent).toHaveBeenCalledTimes(1);

    // A different attacked source still earns its own first line — the throttle dedupes per
    // source, it does not silence the whole endpoint.
    await POST(relayBody({ path: "src-other-cam", password: "wrong" }, { forwardedFor: "203.0.113.13" }));
    expect(mockAppendAuditEvent).toHaveBeenCalledTimes(2);
  });
});
