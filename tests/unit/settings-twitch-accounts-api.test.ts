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

import { PUT } from "../../apps/web/app/api/settings/twitch-accounts/route";

function putRequest(body: Record<string, string>) {
  return new Request("http://localhost/api/settings/twitch-accounts", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}


const storedConfig = {
  twitchClientId: "client",
  twitchClientSecret: "secret",
  twitchDefaultCategoryId: "",
  twitchBroadcastChannelLogin: "jimpanse247",
  twitchBotLogin: "",
  twitchEventsubSecret: "",
  discordWebhookUrl: "",
  smtpHost: "",
  smtpPort: "",
  smtpUser: "",
  smtpPassword: "",
  smtpFrom: "",
  alertEmailTo: "",
  updatedAt: ""
};

describe("Twitch accounts settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockUpdateManagedConfigRecord.mockResolvedValue(undefined);
    mockReadAppState.mockResolvedValue({ managedConfig: { ...storedConfig } });
  });

  it("stores both accounts, trimmed, and names both in the audit trail", async () => {
    const response = await PUT(putRequest({ broadcastChannelLogin: " jimpanse247 ", botLogin: " 3JakeC " }));

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({ twitchBroadcastChannelLogin: "jimpanse247", twitchBotLogin: "3JakeC", twitchClientSecret: "secret" })
    );
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "settings.twitch-accounts.updated",
      expect.stringMatching(/broadcast channel jimpanse247, bot account 3JakeC/)
    );
  });

  it("writes only the fields the request carries", async () => {
    await PUT(putRequest({ botLogin: "3JakeC" }));
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({ twitchBroadcastChannelLogin: "jimpanse247", twitchBotLogin: "3JakeC" })
    );
  });

  it("accepts empty values: no channel means the bot's own channel, no bot login means no check", async () => {
    const response = await PUT(putRequest({ broadcastChannelLogin: "", botLogin: "" }));
    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({ twitchBroadcastChannelLogin: "", twitchBotLogin: "" })
    );
  });

  it.each([
    ["broadcastChannelLogin", "twitch.tv/jimpanse247", /broadcast channel/],
    ["botLogin", "3 JakeC", /bot account/]
  ])("rejects a malformed %s and stores nothing", async (field, value, message) => {
    const response = await PUT(putRequest({ [field]: value }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toMatch(message);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("refuses callers without the owner or admin role", async () => {
    mockRequireApiRoles.mockResolvedValue(new Response("forbidden", { status: 403 }));
    const response = await PUT(putRequest({ broadcastChannelLogin: "jimpanse247" }));
    expect(response.status).toBe(403);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });
});
