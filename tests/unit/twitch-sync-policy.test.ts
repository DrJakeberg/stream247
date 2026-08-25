import { describe, expect, it } from "vitest";
import {
  decideTwitchChannelMetadataWrite,
  isTwitchScheduleSyncEnabled,
  TWITCH_CHANNEL_METADATA_WRITE_MIN_INTERVAL_MS
} from "../../apps/worker/src/twitch-sync-policy";

describe("twitch sync policy", () => {
  it("enables Twitch schedule sync by default", () => {
    expect(isTwitchScheduleSyncEnabled({})).toBe(true);
  });

  it("disables Twitch schedule sync when configured off", () => {
    expect(isTwitchScheduleSyncEnabled({ TWITCH_SCHEDULE_SYNC_ENABLED: "0" })).toBe(false);
  });
});

describe("the channel metadata write decision", () => {
  const changedMetadata = {
    desiredTitle: "Chapter two",
    desiredCategoryId: "509658",
    lastSyncedTitle: "Chapter one",
    lastSyncedCategoryId: "26936",
    lastWriteAtMs: 0,
    nowMs: 1_000_000
  };

  it("never writes while the gate is waiting for the broadcaster connection", () => {
    // The M51 guarantee: with the split configured and no broadcaster connected, a chapter
    // boundary must not produce a Helix write — no matter how overdue the change is.
    expect(decideTwitchChannelMetadataWrite({ ...changedMetadata, gateMode: "waiting-for-broadcaster" })).toEqual({
      write: false,
      reason: "waiting-for-broadcaster"
    });
  });

  it("skips the write when title and category already match", () => {
    expect(
      decideTwitchChannelMetadataWrite({
        ...changedMetadata,
        gateMode: "broadcaster",
        lastSyncedTitle: changedMetadata.desiredTitle,
        lastSyncedCategoryId: changedMetadata.desiredCategoryId
      })
    ).toEqual({ write: false, reason: "unchanged" });
  });

  it("defers a due write that would come within 30 seconds of the previous one", () => {
    expect(
      decideTwitchChannelMetadataWrite({
        ...changedMetadata,
        gateMode: "broadcaster",
        lastWriteAtMs: changedMetadata.nowMs - TWITCH_CHANNEL_METADATA_WRITE_MIN_INTERVAL_MS + 1
      })
    ).toEqual({ write: false, reason: "throttled" });
  });

  it("writes once the interval has passed, through identity or broadcaster alike", () => {
    const afterInterval = {
      ...changedMetadata,
      lastWriteAtMs: changedMetadata.nowMs - TWITCH_CHANNEL_METADATA_WRITE_MIN_INTERVAL_MS
    };
    expect(decideTwitchChannelMetadataWrite({ ...afterInterval, gateMode: "broadcaster" })).toEqual({ write: true });
    expect(decideTwitchChannelMetadataWrite({ ...afterInterval, gateMode: "identity" })).toEqual({ write: true });
  });

  it("allows the first write of a fresh process immediately", () => {
    // lastWriteAtMs of zero means "never wrote"; making a new worker wait 30s for its first sync
    // would delay recovery after every restart for no protective value.
    expect(decideTwitchChannelMetadataWrite({ ...changedMetadata, gateMode: "identity" })).toEqual({ write: true });
  });
});
