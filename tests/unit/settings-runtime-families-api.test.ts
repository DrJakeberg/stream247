import { beforeEach, describe, expect, it, vi } from "vitest";

// M56 part 2: the replay cache, the watchdog thresholds and the feed tuning save through their
// own partial routes, one per folded form, so no form can blank a sibling's values. Every number
// is validated against the same core bounds the resolvers clamp to — the operator hears about an
// out-of-range value from the API, never from a watchdog that silently corrected it.

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
        headers: { "content-type": "application/json" }
      });
    }
  }
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  readAppState: mockReadAppState,
  updateManagedConfigRecord: mockUpdateManagedConfigRecord
}));

import { PUT as putReplayCache } from "../../apps/web/app/api/settings/replay-cache/route";
import { PUT as putWatchdogs } from "../../apps/web/app/api/settings/watchdogs/route";
import { PUT as putFeedTuning } from "../../apps/web/app/api/settings/feed-tuning/route";

function request(body: Record<string, string>) {
  return new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}

const storedManagedConfig = {
  twitchClientId: "keep-me",
  vodCacheEnabled: "",
  vodCacheMaxGb: "",
  vodCacheMaxAssetGb: "",
  feedAudioSilenceSeconds: "",
  uplinkStallTimeoutSeconds: "",
  programFeedTargetSeconds: "",
  updatedAt: ""
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiRoles.mockResolvedValue(null);
  mockAppendAuditEvent.mockResolvedValue(undefined);
  mockUpdateManagedConfigRecord.mockResolvedValue(undefined);
  mockReadAppState.mockResolvedValue({ managedConfig: { ...storedManagedConfig } });
});

describe("managed replay cache API", () => {
  it("writes only the keys the request carries and keeps unrelated keys", async () => {
    const response = await putReplayCache(request({ vodCacheRetentionHours: "48", vodCacheEnabled: "1" }));

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        vodCacheRetentionHours: "48",
        vodCacheEnabled: "1",
        twitchClientId: "keep-me"
      })
    );
  });

  it("rejects switch values that are neither on, off, nor follow-the-environment", async () => {
    const response = await putReplayCache(request({ vodCacheAllowRemoteFallback: "yes" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("rejects out-of-range sizes and durations before anything is persisted", async () => {
    for (const body of [
      { vodCacheMaxGb: "0.5" },
      { vodCacheMaxGb: "9999" },
      { vodCacheMinFreeGb: "junk" },
      { vodCacheRetentionHours: "0" },
      { vodCachePartialMaxAgeHours: "200" },
      { vodCacheDownloadTimeoutSeconds: "5" },
      { vodCacheFailureCooldownSeconds: "10" },
      { vodCacheLimitRate: "8 Mbit" }
    ]) {
      const response = await putReplayCache(request(body));
      expect(response.status).toBe(400);
    }
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("rejects a per-replay ceiling above the whole cache, resolved against the blank half", async () => {
    // Cache ceiling stays at its 20 GB default; a 40 GB per-replay limit could then never be
    // cached and every attempt would waste the line — the pair is refused whole.
    const response = await putReplayCache(request({ vodCacheMaxAssetGb: "40" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("accepts a coherent pair and clearing back to follow-the-environment", async () => {
    const okPair = await putReplayCache(request({ vodCacheMaxGb: "40", vodCacheMaxAssetGb: "10" }));
    expect(okPair.status).toBe(200);

    const cleared = await putReplayCache(request({ vodCacheMaxGb: "", vodCacheMaxAssetGb: "" }));
    expect(cleared.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ vodCacheMaxGb: "", vodCacheMaxAssetGb: "" })
    );
  });
});

describe("managed watchdog thresholds API", () => {
  it("writes only the keys the request carries", async () => {
    const response = await putWatchdogs(request({ feedAudioSilenceSeconds: "120", durationBoundMarginSeconds: "30" }));

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        feedAudioSilenceSeconds: "120",
        durationBoundMarginSeconds: "30",
        twitchClientId: "keep-me"
      })
    );
  });

  it("rejects every threshold outside its clamp instead of silently correcting it", async () => {
    for (const body of [
      { feedAudioSilenceSeconds: "5" },
      { feedAudioGraceSeconds: "-1" },
      { feedStallTimeoutSeconds: "10" },
      { feedStallGraceSeconds: "10" },
      { uplinkStallTimeoutSeconds: "9999" },
      { uplinkNoProgressRestartSeconds: "30" },
      { durationBoundMarginSeconds: "4" },
      { durationBoundMarginSeconds: "121" },
      { feedAudioSilenceSeconds: "soon" }
    ]) {
      const response = await putWatchdogs(request(body));
      expect(response.status).toBe(400);
    }
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("accepts zero grace where the module's first-observation gate makes it safe", async () => {
    const response = await putWatchdogs(request({ feedAudioGraceSeconds: "0", uplinkStallGraceSeconds: "0" }));

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({ feedAudioGraceSeconds: "0", uplinkStallGraceSeconds: "0" })
    );
  });

  it("accepts clearing a threshold back to follow-the-environment", async () => {
    const response = await putWatchdogs(request({ feedStallTimeoutSeconds: "" }));

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({ feedStallTimeoutSeconds: "" })
    );
  });
});

describe("managed feed tuning API", () => {
  it("writes only the keys the request carries", async () => {
    const response = await putFeedTuning(request({ playoutReconnectHours: "24", programFeedTargetSeconds: "4" }));

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        playoutReconnectHours: "24",
        programFeedTargetSeconds: "4",
        twitchClientId: "keep-me"
      })
    );
  });

  it("rejects values outside the core bounds", async () => {
    for (const body of [
      { playoutReconnectHours: "0.5" },
      { playoutReconnectHours: "999" },
      { playoutReconnectWindowSeconds: "2" },
      { programFeedTargetSeconds: "12" },
      { programFeedListSize: "1" },
      { programFeedListSize: "500" },
      { programFeedFailoverSeconds: "0" },
      { programFeedTargetSeconds: "short" }
    ]) {
      const response = await putFeedTuning(request(body));
      expect(response.status).toBe(400);
    }
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("requires whole numbers where the muxer arguments demand them", async () => {
    const response = await putFeedTuning(request({ programFeedListSize: "12.5" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });
});
