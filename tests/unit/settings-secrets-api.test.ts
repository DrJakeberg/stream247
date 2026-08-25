import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireApiRoles, mockAppendAuditEvent, mockReadAppState, mockUpdateManagedConfigRecord } = vi.hoisted(
  () => ({
    mockRequireApiRoles: vi.fn(),
    mockAppendAuditEvent: vi.fn(),
    mockReadAppState: vi.fn(),
    mockUpdateManagedConfigRecord: vi.fn()
  })
);

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
  readAppState: mockReadAppState,
  updateManagedConfigRecord: mockUpdateManagedConfigRecord
}));

import { PUT } from "../../apps/web/app/api/settings/secrets/route";

function putRequest(body: Record<string, string>) {
  return new Request("http://localhost/api/settings/secrets", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}

describe("managed settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockUpdateManagedConfigRecord.mockResolvedValue(undefined);
    mockReadAppState.mockResolvedValue({
      managedConfig: {
        twitchClientId: "",
        twitchClientSecret: "stored-secret",
        twitchDefaultCategoryId: "",
        twitchBroadcastChannelLogin: "",
        discordWebhookUrl: "",
        smtpHost: "",
        smtpPort: "",
        smtpUser: "",
        smtpPassword: "",
        smtpFrom: "",
        alertEmailTo: "",
        updatedAt: ""
      }
    });
  });

  it("stores a valid broadcast channel login, trimmed", async () => {
    const response = await PUT(putRequest({ twitchBroadcastChannelLogin: "  jimpanse247  " }));

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({ twitchBroadcastChannelLogin: "jimpanse247" })
    );
  });

  it("accepts an empty broadcast channel — that is the rollback path, not an error", async () => {
    const response = await PUT(putRequest({ twitchBroadcastChannelLogin: "" }));

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({ twitchBroadcastChannelLogin: "" })
    );
  });

  it("rejects a malformed broadcast channel login instead of silently falling back", async () => {
    // The login decides which channel chat joins and where the watch link points. A typo that
    // quietly reverted to single-account behaviour would look exactly like the feature not
    // working, so the API refuses it and nothing is persisted.
    const response = await PUT(putRequest({ twitchBroadcastChannelLogin: "evil.com/x" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });
});
