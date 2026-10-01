import { describe, expect, it } from "vitest";
import {
  AS_RUN_MAX_LIMIT,
  buildAsRunRowView,
  describeAsRunEndReason,
  formatAsRunSeconds,
  resolveAsRunWindow,
  type AsRunRecord
} from "@stream247/core";
import {
  asRunEndReasonOf,
  asRunInputKindOf,
  asRunRestartIntentOf,
  asRunScheduleContextOf,
  asRunTargetKindOf,
  buildAsRunEnd,
  buildAsRunStartRecord
} from "../../apps/worker/src/as-run.js";

// M76. The question every incident analysis began with: what was on air at 19:38 (channel time) on
// 2026-10-01, the evening Play now did not reach the air. 17:38 UTC.
const T = Date.parse("2026-10-01T17:38:00.000Z");

describe("as-run target kind", () => {
  it.each([
    [{ hasAsset: true, liveBridge: false, reasonCode: "scheduled_match", fallbackTier: "scheduled", lifecycleStatus: "running", overrideMode: "schedule" }, "asset"],
    // A Pin and the operator's Fallback select alike; the override mode tells them apart.
    [{ hasAsset: true, liveBridge: false, reasonCode: "operator_override", fallbackTier: "operator", lifecycleStatus: "running", overrideMode: "asset" }, "asset"],
    [{ hasAsset: true, liveBridge: false, reasonCode: "operator_override", fallbackTier: "operator", lifecycleStatus: "recovering", overrideMode: "fallback" }, "fallback"],
    // A Fallback whose override ran out: whatever selects next is not the operator's Fallback any more.
    [{ hasAsset: true, liveBridge: false, reasonCode: "scheduled_match", fallbackTier: "scheduled", lifecycleStatus: "running", overrideMode: "fallback" }, "asset"],
    [{ hasAsset: true, liveBridge: false, reasonCode: "operator_insert", fallbackTier: "operator", lifecycleStatus: "running", overrideMode: "fallback" }, "insert"],
    [{ hasAsset: true, liveBridge: false, reasonCode: "operator_insert", fallbackTier: "operator", lifecycleStatus: "running", overrideMode: "schedule" }, "insert"],
    [{ hasAsset: true, liveBridge: false, reasonCode: "scheduled_insert", fallbackTier: "scheduled", lifecycleStatus: "running", overrideMode: "schedule" }, "insert"],
    [{ hasAsset: true, liveBridge: false, reasonCode: "global_fallback", fallbackTier: "global-fallback", lifecycleStatus: "recovering", overrideMode: "schedule" }, "fallback"],
    [{ hasAsset: true, liveBridge: false, reasonCode: "generic_fallback", fallbackTier: "generic-fallback", lifecycleStatus: "switching", overrideMode: "schedule" }, "fallback"],
    [{ hasAsset: false, liveBridge: true, reasonCode: "live_bridge", fallbackTier: "operator", lifecycleStatus: "running", overrideMode: "schedule" }, "live"],
    [{ hasAsset: false, liveBridge: false, reasonCode: "scheduled_reconnect", fallbackTier: "none", lifecycleStatus: "reconnecting", overrideMode: "schedule" }, "reconnect"],
    [{ hasAsset: false, liveBridge: false, reasonCode: "standby", fallbackTier: "standby", lifecycleStatus: "standby", overrideMode: "schedule" }, "standby"],
    [{ hasAsset: false, liveBridge: false, reasonCode: "no_asset", fallbackTier: "none", lifecycleStatus: "failed", overrideMode: "schedule" }, "standby"]
  ])("%o -> %s", (input, expected) => {
    expect(asRunTargetKindOf(input)).toBe(expected);
  });
});

describe("as-run input kind", () => {
  it.each([
    ["asset", "/app/data/media/twitch/v2245.mp4", "", "local"],
    ["asset", "file:///app/data/media/library/intro.mp4", "", "local"],
    ["fallback", "/app/data/media/library/fallback.mp4", "", "local"],
    ["asset", "https://rr3---sn.googlevideo.com/videoplayback?itag=18", "", "remote"],
    ["insert", "https://media.example/clip.m3u8", "", "remote"],
    ["asset", "https://rr3---sn.googlevideo.com/videoplayback?itag=299", "https://rr3---sn.googlevideo.com/videoplayback?itag=140", "pair"],
    ["live", "rtmp://relay:1935/live/bridge", "", "live"],
    ["standby", "", "", "slate"],
    ["reconnect", "", "", "slate"]
  ] as const)("%s %s (audio %s) -> %s", (targetKind, input, audioInput, expected) => {
    expect(asRunInputKindOf({ targetKind, input, audioInput })).toBe(expected);
  });
});

describe("as-run schedule context", () => {
  const pool = { blockId: "block_evening", blockPoolId: "pool_twitchyoutube", poolSourceIds: ["source_e2au8vv3", "source_jjwuu0f3"] };

  it("names the pool only when the pool's rotation picked the item from its sources", () => {
    expect(asRunScheduleContextOf({ ...pool, assetSourceId: "source_jjwuu0f3", reasonCode: "scheduled_match" })).toEqual({
      blockId: "block_evening",
      poolId: "pool_twitchyoutube"
    });
    // The local fallback bridged onto the air inside the block: the block, not the pool.
    expect(asRunScheduleContextOf({ ...pool, assetSourceId: "source_library", reasonCode: "global_fallback" })).toEqual({
      blockId: "block_evening",
      poolId: ""
    });
    expect(asRunScheduleContextOf({ ...pool, assetSourceId: "", reasonCode: "standby" })).toEqual({ blockId: "block_evening", poolId: "" });
    expect(
      asRunScheduleContextOf({ blockId: "", blockPoolId: "", poolSourceIds: [], assetSourceId: "source_jjwuu0f3", reasonCode: "scheduled_match" })
    ).toEqual({ blockId: "", poolId: "" });
  });

  // The DUT case: nearly every asset comes from the pool's own sources, so the source does not say who
  // picked it.
  it.each(["generic_fallback", "global_fallback", "operator_override", "operator_insert", "scheduled_insert", "manual_next", "graceful_handoff"])(
    "does not name the pool for a %s from one of the pool's sources",
    (reasonCode) => {
      expect(asRunScheduleContextOf({ ...pool, assetSourceId: "source_jjwuu0f3", reasonCode })).toEqual({
        blockId: "block_evening",
        poolId: ""
      });
    }
  );
});

describe("as-run end reason", () => {
  it.each([
    [{ plannedReason: "", stopIntent: "", naturalBoundary: true, exitedCleanly: true }, "natural-end"],
    [{ plannedReason: "", stopIntent: "", naturalBoundary: false, exitedCleanly: true }, "stopped"],
    [{ plannedReason: "", stopIntent: "", naturalBoundary: false, exitedCleanly: false }, "failed"],
    [{ plannedReason: "switch", stopIntent: "", naturalBoundary: false, exitedCleanly: false }, "switch"],
    [{ plannedReason: "duration-bound", stopIntent: "", naturalBoundary: false, exitedCleanly: false }, "duration-bound"],
    [{ plannedReason: "feed-stalled", stopIntent: "", naturalBoundary: false, exitedCleanly: false }, "feed-watchdog"],
    [{ plannedReason: "feed-audio-stalled", stopIntent: "", naturalBoundary: false, exitedCleanly: false }, "feed-watchdog"],
    [{ plannedReason: "scheduled-reconnect", stopIntent: "", naturalBoundary: false, exitedCleanly: true }, "scheduled-reconnect"],
    [{ plannedReason: "crash-loop-reset", stopIntent: "", naturalBoundary: false, exitedCleanly: false }, "crash-loop-reset"],
    [{ plannedReason: "destination-missing", stopIntent: "", naturalBoundary: false, exitedCleanly: false }, "destination-missing"],
    [{ plannedReason: "restart-requested", stopIntent: "skip", naturalBoundary: false, exitedCleanly: false }, "skip"],
    [{ plannedReason: "restart-requested", stopIntent: "switch", naturalBoundary: false, exitedCleanly: false }, "switch"],
    [{ plannedReason: "restart-requested", stopIntent: "operator-restart", naturalBoundary: false, exitedCleanly: false }, "operator-restart"],
    [{ plannedReason: "restart-requested", stopIntent: "", naturalBoundary: false, exitedCleanly: false }, "operator-restart"],
    [{ plannedReason: "some-future-reason", stopIntent: "", naturalBoundary: false, exitedCleanly: false }, "stopped"]
  ] as const)("%o -> %s", (input, expected) => {
    expect(asRunEndReasonOf(input)).toBe(expected);
  });

  it.each([
    // Skip (operator or chat vote): the running item is the skip target.
    ["skip", { runningAssetId: "a1", skipAssetId: "a1", nextAssetId: "a2", selectedBeforeSlateAssetId: "" }, "skip"],
    // Pin, Play now, fallback: something else comes on.
    ["pin", { runningAssetId: "a1", skipAssetId: "", nextAssetId: "a2", selectedBeforeSlateAssetId: "" }, "switch"],
    ["nothing playable", { runningAssetId: "a1", skipAssetId: "a9", nextAssetId: "", selectedBeforeSlateAssetId: "" }, "switch"],
    // Restart and hard reload: the same item again.
    ["restart", { runningAssetId: "a1", skipAssetId: "", nextAssetId: "a1", selectedBeforeSlateAssetId: "" }, "operator-restart"],
    ["restart of a slate", { runningAssetId: "", skipAssetId: "", nextAssetId: "", selectedBeforeSlateAssetId: "" }, "operator-restart"],
    // Without the relay the reconnect slate comes first; the request was for what it took the place of.
    ["direct-mode restart", { runningAssetId: "a1", skipAssetId: "", nextAssetId: "", selectedBeforeSlateAssetId: "a1" }, "operator-restart"],
    ["direct-mode pin", { runningAssetId: "a1", skipAssetId: "", nextAssetId: "", selectedBeforeSlateAssetId: "a2" }, "switch"],
    ["direct-mode skip", { runningAssetId: "a1", skipAssetId: "a1", nextAssetId: "", selectedBeforeSlateAssetId: "a2" }, "skip"]
  ] as const)("tells the web's one restart request apart: %s", (_name, input, expected) => {
    expect(asRunRestartIntentOf(input)).toBe(expected);
  });
});

describe("as-run rows", () => {
  const start = (overrides: Partial<Parameters<typeof buildAsRunStartRecord>[0]> = {}) =>
    buildAsRunStartRecord({
      id: "asrun_1",
      startedAtMs: T,
      targetKind: "asset",
      asset: { id: "asset_yt1", sourceId: "source_jjwuu0f3", durationSeconds: 2700.4 },
      title: "Episode 12",
      blockId: "block_evening",
      poolId: "pool_twitchyoutube",
      reasonCode: "scheduled_match",
      queueKind: "asset",
      input: "https://rr3---sn.googlevideo.com/videoplayback?itag=299",
      audioInput: "https://rr3---sn.googlevideo.com/videoplayback?itag=140",
      formatId: "299+140",
      formatCandidate: "pair-1080",
      ...overrides
    });

  it("opens a row with what aired and how, and nothing about its end", () => {
    expect(start()).toEqual({
      id: "asrun_1",
      startedAt: "2026-10-01T17:38:00.000Z",
      endedAt: "",
      targetKind: "asset",
      assetId: "asset_yt1",
      title: "Episode 12",
      sourceId: "source_jjwuu0f3",
      poolId: "pool_twitchyoutube",
      blockId: "block_evening",
      reasonCode: "scheduled_match",
      queueKind: "asset",
      inputKind: "pair",
      formatId: "299+140",
      formatCandidate: "pair-1080",
      plannedSeconds: 2700,
      airedSeconds: 0,
      endReason: "",
      exitCode: ""
    });
    // No signed media URL is kept: the row says how, not where from.
    expect(JSON.stringify(start())).not.toContain("googlevideo");
  });

  it("has no planned length for a slate or an unprobed item", () => {
    const slate = start({ targetKind: "standby", asset: null, title: "Replay standby", input: "", audioInput: "", formatId: "", formatCandidate: "" });
    expect(slate).toMatchObject({ assetId: "", sourceId: "", inputKind: "slate", plannedSeconds: 0 });
    expect(start({ asset: { id: "asset_new", sourceId: "source_e2au8vv3", durationSeconds: 0 } }).plannedSeconds).toBe(0);
  });

  it("ends a row from the same instants playout.process.exit measures ranForMs from", () => {
    const ranForMs = 2_698_600;
    const end = buildAsRunEnd({
      startedAtMs: T,
      exitedAtMs: T + ranForMs,
      plannedReason: "",
      stopIntent: "",
      naturalBoundary: true,
      exitCode: 0,
      exitSignal: null
    });
    expect(end).toEqual({ endedAt: "2026-10-01T18:22:58.600Z", airedSeconds: 2699, endReason: "natural-end", exitCode: "0" });
    expect(Math.abs(end.airedSeconds - ranForMs / 1000)).toBeLessThanOrEqual(0.5);
  });

  it("keeps the exit code or the signal of a run that failed or was killed", () => {
    const failed = buildAsRunEnd({ startedAtMs: T, exitedAtMs: T + 4_000, plannedReason: "", stopIntent: "", naturalBoundary: false, exitCode: 8, exitSignal: null });
    expect(failed).toMatchObject({ airedSeconds: 4, endReason: "failed", exitCode: "8" });
    const killed = buildAsRunEnd({ startedAtMs: T, exitedAtMs: T + 600_000, plannedReason: "switch", stopIntent: "", naturalBoundary: false, exitCode: null, exitSignal: "SIGTERM" });
    expect(killed).toMatchObject({ endReason: "switch", exitCode: "SIGTERM" });
    // A clock that went backwards never makes a negative run.
    expect(buildAsRunEnd({ startedAtMs: T, exitedAtMs: T - 5, plannedReason: "", stopIntent: "", naturalBoundary: false, exitCode: 1, exitSignal: null }).airedSeconds).toBe(0);
  });
});

describe("as-run read window", () => {
  it("defaults to the 24 hours before now and 200 rows", () => {
    expect(resolveAsRunWindow({ nowMs: T })).toEqual({
      ok: true,
      window: { fromIso: "2026-09-30T17:38:00.000Z", toIso: "2026-10-01T17:38:00.000Z", limit: 200 }
    });
  });

  it("takes from = to as one moment, normalizes offsets, and caps the limit", () => {
    expect(resolveAsRunWindow({ from: "2026-10-01T19:38:00+02:00", to: "2026-10-01T17:38:00Z", limit: "50000", nowMs: T })).toEqual({
      ok: true,
      window: { fromIso: "2026-10-01T17:38:00.000Z", toIso: "2026-10-01T17:38:00.000Z", limit: AS_RUN_MAX_LIMIT }
    });
    expect(resolveAsRunWindow({ to: "2026-10-01T12:00:00.000Z", nowMs: T })).toMatchObject({
      window: { fromIso: "2026-09-30T12:00:00.000Z", toIso: "2026-10-01T12:00:00.000Z" }
    });
  });

  it.each([
    [{ from: "yesterday" }, "from must be an ISO timestamp."],
    [{ to: "now" }, "to must be an ISO timestamp."],
    [{ from: "2026-10-02T00:00:00Z", to: "2026-10-01T00:00:00Z" }, "from must not be later than to."],
    [{ limit: "0" }, "limit must be a positive whole number."],
    [{ limit: "ten" }, "limit must be a positive whole number."],
    [{ limit: "2.5" }, "limit must be a positive whole number."],
    [{ to: "-271821-04-20T00:00:00.000Z" }, "from must be an ISO timestamp."]
  ])("refuses %o", (query, message) => {
    expect(resolveAsRunWindow({ ...query, nowMs: T })).toEqual({ ok: false, message });
  });
});

describe("as-run console rows", () => {
  const record = (overrides: Partial<AsRunRecord> = {}): AsRunRecord => ({
    id: "asrun_1",
    startedAt: "2026-10-01T17:38:00.000Z",
    endedAt: "2026-10-01T18:22:58.000Z",
    targetKind: "asset",
    assetId: "asset_yt1",
    title: "Episode 12",
    sourceId: "source_jjwuu0f3",
    poolId: "pool_twitchyoutube",
    blockId: "block_evening",
    reasonCode: "scheduled_match",
    queueKind: "asset",
    inputKind: "pair",
    formatId: "299+140",
    formatCandidate: "pair-1080",
    plannedSeconds: 2700,
    airedSeconds: 2698,
    endReason: "natural-end",
    exitCode: "0",
    ...overrides
  });
  const names = {
    sourceName: (id: string) => (id === "source_jjwuu0f3" ? "YouTube channel" : ""),
    poolName: (id: string) => (id === "pool_twitchyoutube" ? "TwitchYoutube" : ""),
    blockTitle: (id: string) => (id === "block_evening" ? "Evening replays" : "")
  };

  it("reads a finished run in UTC and in the channel's clock", () => {
    expect(buildAsRunRowView(record(), { nowMs: T, timeZone: "Europe/Berlin", ...names })).toEqual({
      id: "asrun_1",
      start: "2026-10-01 17:38:00 UTC",
      startChannel: "19:38:00 Europe/Berlin",
      end: "2026-10-01 18:22:58 UTC",
      endChannel: "20:22:58 Europe/Berlin",
      title: "Episode 12",
      kind: "Programme",
      origin: "YouTube channel · pool TwitchYoutube · block Evening replays",
      input: "Video+audio pair · 299+140 (pair-1080)",
      ended: "Natural end",
      timing: "planned 45:00 · aired 44:58"
    });
  });

  it("reads a run on air, a channel on UTC, gone names and a failure", () => {
    const onAir = buildAsRunRowView(record({ endedAt: "", airedSeconds: 0, endReason: "", exitCode: "" }), {
      nowMs: T + 125_000,
      timeZone: "UTC",
      sourceName: () => "",
      poolName: () => "",
      blockTitle: () => ""
    });
    expect(onAir).toMatchObject({
      startChannel: "",
      end: "On air",
      endChannel: "",
      origin: "source_jjwuu0f3 · pool pool_twitchyoutube · block block_evening",
      ended: "On air",
      timing: "planned 45:00 · aired 2:05 so far"
    });
    const failed = buildAsRunRowView(
      record({ targetKind: "fallback", inputKind: "local", formatId: "", formatCandidate: "", plannedSeconds: 0, airedSeconds: 3, endReason: "failed", exitCode: "255", poolId: "" }),
      { nowMs: T, timeZone: "Europe/Berlin", ...names }
    );
    expect(failed).toMatchObject({ kind: "Fallback", input: "Local file", ended: "Failed (exit 255)", timing: "aired 0:03" });
  });

  it("labels every end reason and formats long runs", () => {
    expect(describeAsRunEndReason("process-gone")).toBe("Process gone");
    expect(describeAsRunEndReason("feed-watchdog")).toBe("Feed watchdog");
    expect(describeAsRunEndReason("")).toBe("On air");
    expect(formatAsRunSeconds(3723)).toBe("1:02:03");
    expect(formatAsRunSeconds(-4)).toBe("0:00");
  });
});
