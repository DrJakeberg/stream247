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

// The endpoint mediamtx asks about every publish and read. It carries no session — the relay
// calls it server-side, and the credential under test IS the request body — which is exactly why
// its failure answers must all look the same: a bare 403, no reason, no body.

const PUBLISH_KEY = "push-key-cccccccccccccccccccccccc";
const INTERNAL_KEY = "internal-key-dddddddddddddddddddd";

function relayBody(overrides: Record<string, unknown>): Request {
  return new Request("http://web:3000/api/relay/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
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

  it("denies when the stores are unreachable, instead of failing open", async () => {
    mockReadRelayInternalKey.mockRejectedValue(new Error("database is down"));
    const response = await POST(relayBody({ action: "read", path: "src-studio-cam", password: INTERNAL_KEY }));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
  });

  it("rate limits per source address, valid credentials included", async () => {
    for (let attempt = 0; attempt < RELAY_AUTH_RATE_LIMIT.limit; attempt += 1) {
      await POST(relayBody({ path: "src-studio-cam", password: "wrong" }));
    }
    const overLimit = await POST(relayBody({ path: "src-studio-cam", password: PUBLISH_KEY }));
    expect(overLimit.status).toBe(403);

    // A different address is not affected by the noisy one.
    const otherAddress = await POST(relayBody({ ip: "203.0.113.8", path: "src-studio-cam", password: PUBLISH_KEY }));
    expect(otherAddress.status).toBe(200);
  });
});
