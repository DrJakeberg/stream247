import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReadAppState, mockUpdateTwitchConnectionRecord, mockUpdateBroadcasterRecord, mockAppendAuditEvent } =
  vi.hoisted(() => ({
    mockReadAppState: vi.fn(),
    mockUpdateTwitchConnectionRecord: vi.fn(),
    mockUpdateBroadcasterRecord: vi.fn(),
    mockAppendAuditEvent: vi.fn()
  }));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  findTeamGrantByLogin: vi.fn(),
  getManagedTwitchConfig: () => ({ clientId: "", clientSecret: "", broadcastChannelLogin: "" }),
  readAppState: mockReadAppState,
  updateTwitchBroadcasterConnectionRecord: mockUpdateBroadcasterRecord,
  updateTwitchConnectionRecord: mockUpdateTwitchConnectionRecord,
  upsertUserRecord: vi.fn()
}));

import { recordTwitchBroadcasterError, recordTwitchError } from "../../apps/web/lib/server/twitch";

function connection(overrides: Record<string, unknown> = {}) {
  return {
    status: "connected",
    broadcasterId: "3141",
    broadcasterLogin: "jimpanse247",
    accessToken: "identity-token",
    refreshToken: "identity-refresh",
    connectedAt: "2026-09-01T20:27:49.000Z",
    tokenExpiresAt: "",
    lastRefreshAt: "",
    lastMetadataSyncAt: "",
    lastSyncedTitle: "",
    lastSyncedCategoryName: "",
    lastSyncedCategoryId: "",
    lastScheduleSyncAt: "",
    liveStatus: "unknown",
    viewerCount: 0,
    startedAt: "",
    error: "",
    ...overrides
  };
}

function stateWith(twitch: Record<string, unknown>) {
  return { twitch, twitchBroadcaster: connection({ status: "not-connected" }), managedConfig: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recording an identity connection failure", () => {
  it("leaves a working connection untouched when a fresh connect attempt is rejected", async () => {
    // The bug this closes: a second callback without a matching state cookie — a double-clicked
    // connect button or a stale tab — marked a healthy connection broken. Metadata sync,
    // moderation sync and event registration are all gated on the connected status, so the
    // emote-only switch stopped moving while chat itself kept working. Nothing about a rejected
    // attempt is evidence about the token already stored.
    mockReadAppState.mockResolvedValue(stateWith(connection()));

    await recordTwitchError("Twitch callback arrived without a matching state cookie.");

    expect(mockUpdateTwitchConnectionRecord).not.toHaveBeenCalled();
    // The failure is still on the record — it just does not take the connection down with it.
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "twitch.error",
      expect.stringContaining("matching state cookie")
    );
  });

  it("records a rejected connect attempt when nothing is connected yet", async () => {
    // The operator's only signal that the first attempt failed.
    mockReadAppState.mockResolvedValue(stateWith(connection({ status: "not-connected", accessToken: "" })));

    await recordTwitchError("Twitch callback did not include an authorization code.");

    expect(mockUpdateTwitchConnectionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        error: "Twitch callback did not include an authorization code."
      })
    );
  });

  it("still marks the connection broken when a refresh reports the stored token is gone", async () => {
    // The other half of the rule. A 401 on refresh is evidence about the stored connection, so
    // suppressing it would leave the dashboard claiming a connection that cannot do any work.
    mockReadAppState.mockResolvedValue(stateWith(connection()));

    await recordTwitchError("Twitch token refresh failed with status 401.", "existing-connection");

    expect(mockUpdateTwitchConnectionRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "Twitch token refresh failed with status 401." })
    );
  });

  it("keeps the broadcaster slot on the same rule it already had", async () => {
    // Mirrored, not duplicated: the slot's long-standing behaviour must survive the move to the
    // shared decision unchanged.
    mockReadAppState.mockResolvedValue({
      twitch: connection(),
      twitchBroadcaster: connection({ broadcasterLogin: "3jakec" }),
      managedConfig: {}
    });

    await recordTwitchBroadcasterError("Twitch authorised the wrong account.");

    expect(mockUpdateBroadcasterRecord).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("twitch.broadcaster.error", expect.any(String));
  });
});
