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

import { PUT as putOperations } from "../../apps/web/app/api/settings/operations/route";
import { PUT as putEncoder } from "../../apps/web/app/api/settings/encoder/route";

function request(body: Record<string, string>) {
  return new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}

const storedManagedConfig = {
  twitchClientId: "keep-me",
  ffmpegPreset: "",
  ffmpegMaxrate: "",
  ffmpegBufsize: "",
  ffmpegAudioBitrate: "",
  diskWatermarkEnabled: "",
  diskWatermarkTriggerPercent: "",
  diskWatermarkRecoverPercent: "",
  streamChatOverlayEnabled: "",
  streamAlertsEnabled: "",
  twitchScheduleSyncEnabled: "1",
  updatedAt: ""
};

describe("managed operations API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockUpdateManagedConfigRecord.mockResolvedValue(undefined);
    mockReadAppState.mockResolvedValue({ managedConfig: { ...storedManagedConfig } });
  });

  it("writes only the keys the request carries — the two folded forms save independently", async () => {
    const response = await putOperations(request({ streamChatOverlayEnabled: "1" }));

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        streamChatOverlayEnabled: "1",
        // Untouched keys keep their stored values instead of being blanked.
        twitchScheduleSyncEnabled: "1",
        twitchClientId: "keep-me"
      })
    );
  });

  it("rejects a switch value that is neither on, off, nor follow-the-environment", async () => {
    const response = await putOperations(request({ streamAlertsEnabled: "yes" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range watermark percent before anything is persisted", async () => {
    const response = await putOperations(request({ diskWatermarkTriggerPercent: "120" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("rejects a misordered watermark pair whole, like the worker would", async () => {
    const response = await putOperations(
      request({ diskWatermarkTriggerPercent: "30", diskWatermarkRecoverPercent: "20" })
    );

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("checks a half-filled pair against what the blank half resolves to", async () => {
    // Only the trigger is managed; recovery falls back to the default of 15, so a trigger of 40
    // would make the resolved pair misordered and the worker would ignore it whole.
    const response = await putOperations(request({ diskWatermarkTriggerPercent: "40" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("accepts a valid pair and clearing values back to follow-the-environment", async () => {
    const okPair = await putOperations(
      request({ diskWatermarkTriggerPercent: "20", diskWatermarkRecoverPercent: "30" })
    );
    expect(okPair.status).toBe(200);

    const cleared = await putOperations(
      request({ diskWatermarkTriggerPercent: "", diskWatermarkRecoverPercent: "", diskWatermarkEnabled: "" })
    );
    expect(cleared.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ diskWatermarkTriggerPercent: "", diskWatermarkRecoverPercent: "" })
    );
  });

  // M57: the observation-only system-volume pair and the retention sweep save through the same
  // partial route, with the same whole-pair rule for the new percent pair and day validation
  // for the protection window.
  it("stores the system-volume pair and the retention settings", async () => {
    const response = await putOperations(
      request({
        systemVolumeTriggerPercent: "20",
        systemVolumeRecoverPercent: "30",
        assetRetentionEnabled: "1",
        assetRetentionProtectionDays: "14"
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        systemVolumeTriggerPercent: "20",
        systemVolumeRecoverPercent: "30",
        assetRetentionEnabled: "1",
        assetRetentionProtectionDays: "14",
        twitchClientId: "keep-me"
      })
    );
  });

  it("rejects a misordered system-volume pair whole, like the worker would", async () => {
    const response = await putOperations(
      request({ systemVolumeTriggerPercent: "30", systemVolumeRecoverPercent: "20" })
    );

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("rejects a protection window that is not a whole number of days in range", async () => {
    for (const value of ["0", "2.5", "400", "junk"]) {
      const response = await putOperations(request({ assetRetentionProtectionDays: value }));
      expect(response.status).toBe(400);
    }
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("validates the retention switch like every other managed flag", async () => {
    const response = await putOperations(request({ assetRetentionEnabled: "yes" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });
});

describe("managed encoder API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockUpdateManagedConfigRecord.mockResolvedValue(undefined);
    mockReadAppState.mockResolvedValue({ managedConfig: { ...storedManagedConfig } });
  });

  it("stores trimmed encoder values and leaves unrelated keys alone", async () => {
    const response = await putEncoder(
      request({ ffmpegPreset: " medium ", ffmpegMaxrate: "6000k", ffmpegBufsize: "", ffmpegAudioBitrate: "128k" })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        ffmpegPreset: "medium",
        ffmpegMaxrate: "6000k",
        ffmpegBufsize: "",
        ffmpegAudioBitrate: "128k",
        twitchClientId: "keep-me"
      })
    );
  });

  it("rejects a preset the encoder would refuse", async () => {
    const response = await putEncoder(request({ ffmpegPreset: "warpspeed" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });

  it("rejects a malformed bitrate instead of letting the encoder crash on it later", async () => {
    const response = await putEncoder(request({ ffmpegMaxrate: "fast" }));

    expect(response.status).toBe(400);
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });
});
