import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireApiRoles,
  mockAppendAuditEvent,
  mockAppendPresenceWindowRecord,
  mockReadAppState
} = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockAppendPresenceWindowRecord: vi.fn(),
  mockReadAppState: vi.fn()
}));

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  }
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  appendPresenceWindowRecord: mockAppendPresenceWindowRecord,
  readAppState: mockReadAppState
}));

import { POST } from "../../apps/web/app/api/moderation/presence/route";

describe("moderation presence API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockAppendPresenceWindowRecord.mockResolvedValue(undefined);
    mockReadAppState.mockResolvedValue({
      moderation: {
        enabled: true,
        command: "here",
        defaultMinutes: 30,
        minMinutes: 10,
        maxMinutes: 60,
        requirePrefix: true,
        fallbackEmoteOnly: true
      }
    });
  });

  it("returns the formatted clamp message and persists requested/applied fields", async () => {
    const response = await POST(
      new Request("http://localhost/api/moderation/presence", {
        method: "POST",
        body: JSON.stringify({
          actor: "Mod\u200B",
          input: "!here 5"
        }),
        headers: {
          "content-type": "application/json"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mockAppendPresenceWindowRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "Mod",
        minutes: 10,
        requestedMinutes: 5,
        appliedMinutes: 10,
        clampReason: "minimum"
      })
    );

    const payload = (await response.json()) as {
      message: string;
      window: {
        actor: string;
        requestedMinutes: number | null;
        minutes: number;
        clampReason: string;
        expiresAt: string;
      };
    };
    expect(payload.message).toBe("received !here 5, minimum is 10; window set to 10 min");
    expect(payload.window).toMatchObject({
      actor: "Mod",
      requestedMinutes: 5,
      minutes: 10,
      clampReason: "minimum"
    });
    expect(new Date(payload.window.expiresAt).toISOString()).toBe(payload.window.expiresAt);
  });
});
