import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAppendAuditEvent, mockReadAppState, mockUpdateDestinationRecord, mockUpdatePlayoutRuntime } = vi.hoisted(() => ({
  mockAppendAuditEvent: vi.fn(),
  mockReadAppState: vi.fn(),
  mockUpdateDestinationRecord: vi.fn(),
  mockUpdatePlayoutRuntime: vi.fn()
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  readAppState: mockReadAppState,
  updateDestinationRecord: mockUpdateDestinationRecord,
  updatePlayoutRuntime: mockUpdatePlayoutRuntime
}));

import { runBroadcastAction } from "../../apps/web/lib/server/broadcast";

// M74. What each operator action writes for the worker, with and without the relay. The DUT
// (2026-10-01, v2.1.0-rc.1, relay on) showed what the restart flag did there: Play now put the reconnect
// slate on air for 18 s, dropped the insert and started a different pool item from 0.

type Playout = Record<string, unknown>;

function playout(overrides: Playout = {}): Playout {
  return {
    status: "running",
    currentAssetId: "asset_archive",
    currentTitle: "Archive",
    desiredAssetId: "asset_archive",
    previousAssetId: "",
    restartRequestedAt: "",
    heartbeatAt: "",
    overrideMode: "schedule",
    overrideAssetId: "",
    overrideUntil: "",
    manualNextAssetId: "",
    manualNextRequestedAt: "",
    insertAssetId: "",
    insertRequestedAt: "",
    insertStatus: "",
    skipAssetId: "",
    skipUntil: "",
    pendingAction: "",
    pendingActionRequestedAt: "",
    liveBridgeStatus: "",
    liveBridgeInputUrl: "",
    queueItems: [],
    message: "",
    ...overrides
  };
}

function asset(overrides: Record<string, unknown>) {
  return {
    id: "asset_x",
    sourceId: "source_x",
    title: "Item",
    path: "/app/data/media/item.mp4",
    status: "ready",
    includeInProgramming: true,
    isGlobalFallback: false,
    fallbackPriority: 100,
    cachePath: "",
    cacheStatus: "",
    ...overrides
  };
}

const youtubeItem = asset({ id: "asset_yt", title: "YouTube item", path: "https://www.youtube.com/watch?v=abc123" });
const uncachedArchive = asset({ id: "asset_vod", title: "Archive 2571234567", path: "https://www.twitch.tv/videos/2571234567" });

let runtime: Playout;
let writes: Playout[];

function seed(state: { playout?: Playout; assets?: unknown[]; destinations?: unknown[]; managedConfig?: Record<string, string> }) {
  runtime = playout(state.playout);
  mockReadAppState.mockResolvedValue({
    playout: runtime,
    assets: state.assets ?? [youtubeItem, uncachedArchive],
    destinations: state.destinations ?? [],
    managedConfig: state.managedConfig ?? {}
  });
}

function lastWrite(): Playout {
  expect(writes.length).toBeGreaterThan(0);
  return writes[writes.length - 1]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  mockAppendAuditEvent.mockResolvedValue(undefined);
  mockUpdateDestinationRecord.mockResolvedValue(undefined);
  mockUpdatePlayoutRuntime.mockImplementation(async (updater: (current: Playout) => Playout) => {
    const next = await updater(runtime);
    writes.push(next);
    return next;
  });
  vi.stubEnv("TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ["relay", "1"],
  ["direct RTMP", ""]
])("Play now and Insert (%s mode)", (_mode, relayFlag) => {
  beforeEach(() => {
    vi.stubEnv("STREAM247_RELAY_ENABLED", relayFlag);
  });

  it.each([
    ["play_now", "playout.play-now.requested", "Play now requested for YouTube item."],
    ["trigger_insert", "playout.insert.requested", "Insert requested for YouTube item."]
  ] as const)("%s queues the insert without the restart flag", async (type, auditType, message) => {
    seed({ playout: { manualNextAssetId: "asset_next", manualNextRequestedAt: "2026-10-01T00:00:00.000Z" } });

    await expect(runBroadcastAction({ type, assetId: "asset_yt" })).resolves.toEqual({ ok: true, message });

    const written = lastWrite();
    expect(written.insertAssetId).toBe("asset_yt");
    expect(written.insertStatus).toBe("pending");
    expect(written.insertRequestedAt).not.toBe("");
    // The running item stays on air until the worker switches; nothing asks for a restart or a slate.
    expect(written.restartRequestedAt).toBe("");
    expect(written.status).toBe("running");
    expect(written.desiredAssetId).toBe("asset_archive");
    // Play now still takes the queued Move next out (follow-up in PLANS.md M74).
    expect(written.manualNextAssetId).toBe("");
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(auditType, expect.stringContaining("YouTube item"));
  });

  it("refuses a Twitch archive the playout cannot start, by the playout's own rule", async () => {
    seed({});

    await expect(runBroadcastAction({ type: "play_now", assetId: "asset_vod" })).rejects.toThrow(
      /Archive 2571234567 is a Twitch archive that is not downloaded yet/
    );
    expect(mockUpdatePlayoutRuntime).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["the archive is cached", { assets: [asset({ ...uncachedArchive, cacheStatus: "ready" })] }],
    ["the archive is too large to cache (always streamed)", { assets: [asset({ ...uncachedArchive, cacheStatus: "too-large" })] }],
    ["remote fallback is on in the managed settings", { managedConfig: { vodCacheAllowRemoteFallback: "1" } }]
  ])("queues a Twitch archive when %s", async (_why, state) => {
    seed(state);

    await runBroadcastAction({ type: "trigger_insert", assetId: "asset_vod" });

    expect(lastWrite().insertAssetId).toBe("asset_vod");
  });

  it("queues a Twitch archive when remote fallback is on in the env and nothing is managed", async () => {
    vi.stubEnv("TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK", "1");
    seed({});

    await runBroadcastAction({ type: "play_now", assetId: "asset_vod" });

    expect(lastWrite().insertStatus).toBe("pending");
  });

  it("refuses the item already on air, as Move next does", async () => {
    // The form preselects the item on air; the worker would have started it again from 0 as an insert.
    seed({ playout: { currentAssetId: "asset_yt" } });

    await expect(runBroadcastAction({ type: "play_now", assetId: "asset_yt" })).rejects.toThrow("The selected asset is already on air.");
    expect(mockUpdatePlayoutRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ["Pin", "asset", /A Pin is holding the air/],
    ["Fallback", "fallback", /A Fallback is holding the air/]
  ])("refuses while a %s holds the air: the worker would drop the insert as preempted", async (_name, overrideMode, error) => {
    seed({
      playout: { overrideMode, overrideAssetId: "asset_archive", overrideUntil: "2099-01-01T00:00:00.000Z" },
      assets: [youtubeItem, asset({ id: "asset_archive", title: "Archive" })]
    });

    await expect(runBroadcastAction({ type: "trigger_insert", assetId: "asset_yt" })).rejects.toThrow(error);
    expect(mockUpdatePlayoutRuntime).not.toHaveBeenCalled();
  });

  it("accepts once the pin has run out", async () => {
    seed({
      playout: { overrideMode: "asset", overrideAssetId: "asset_archive", overrideUntil: "2020-01-01T00:00:00.000Z" },
      assets: [youtubeItem, asset({ id: "asset_archive", title: "Archive" })]
    });

    await runBroadcastAction({ type: "play_now", assetId: "asset_yt" });

    expect(lastWrite().insertStatus).toBe("pending");
  });

  it("accepts while the pinned item is skip-held: the override arm leaves it out (M78)", async () => {
    seed({
      playout: {
        overrideMode: "asset",
        overrideAssetId: "asset_archive",
        overrideUntil: "2099-01-01T00:00:00.000Z",
        skipAssetId: "asset_archive",
        skipUntil: "2099-01-01T00:00:00.000Z"
      },
      assets: [youtubeItem, asset({ id: "asset_archive", title: "Archive" })]
    });

    await runBroadcastAction({ type: "play_now", assetId: "asset_yt" });

    expect(lastWrite().insertStatus).toBe("pending");
  });

  it.each(["pending", "active"])(
    "refuses while a Live Bridge is %s: the takeover ends the insert (M78)",
    async (liveBridgeStatus) => {
      seed({ playout: { liveBridgeStatus } });

      await expect(runBroadcastAction({ type: "play_now", assetId: "asset_yt" })).rejects.toThrow(
        "Live Bridge is on air, and it ends an insert. Release Live Bridge first, then play YouTube item."
      );
      expect(mockUpdatePlayoutRuntime).not.toHaveBeenCalled();
    }
  );

  it("names the Live Bridge, not a Pin left running under it: the live arm comes first (M78)", async () => {
    seed({
      playout: {
        liveBridgeStatus: "active",
        liveBridgeInputUrl: "rtmp://bridge.example/live",
        overrideMode: "asset",
        overrideAssetId: "asset_archive",
        overrideUntil: "2099-01-01T00:00:00.000Z"
      },
      assets: [youtubeItem, asset({ id: "asset_archive", title: "Archive" })]
    });

    // Naming the Pin sent the operator to Resume schedule, and the next Play now was refused for the bridge.
    await expect(runBroadcastAction({ type: "play_now", assetId: "asset_yt" })).rejects.toThrow(
      "Live Bridge is on air, and it ends an insert. Release Live Bridge first, then play YouTube item."
    );
    expect(mockUpdatePlayoutRuntime).not.toHaveBeenCalled();
  });

  it("accepts while a Live Bridge is releasing: the schedule is back at the next cycle", async () => {
    seed({ playout: { liveBridgeStatus: "releasing" } });

    await runBroadcastAction({ type: "play_now", assetId: "asset_yt" });

    expect(lastWrite().insertStatus).toBe("pending");
  });

  it("refuses an item under a skip hold: the worker would drop the insert as unavailable", async () => {
    seed({ playout: { skipAssetId: "asset_yt", skipUntil: "2099-01-01T00:00:00.000Z" } });

    await expect(runBroadcastAction({ type: "play_now", assetId: "asset_yt" })).rejects.toThrow(
      "YouTube item is held out by a Skip or Remove next. Resume schedule clears the hold."
    );
    expect(mockUpdatePlayoutRuntime).not.toHaveBeenCalled();
  });

  it("records a pending insert it replaces as dropped", async () => {
    seed({
      playout: { insertAssetId: "asset_vod", insertRequestedAt: "2026-10-01T00:12:39.000Z", insertStatus: "pending" },
      assets: [youtubeItem, asset({ ...uncachedArchive, cacheStatus: "ready" })]
    });

    await runBroadcastAction({ type: "play_now", assetId: "asset_yt" });

    expect(lastWrite()).toMatchObject({ insertAssetId: "asset_yt", insertStatus: "pending" });
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "playout.insert.dropped",
      "Insert Archive 2571234567 was dropped before it aired (replaced by YouTube item)."
    );
  });

  it("does not record a drop for a repeated request of the same item, or for an insert that has aired", async () => {
    seed({ playout: { insertAssetId: "asset_yt", insertRequestedAt: "2026-10-01T00:12:39.000Z", insertStatus: "pending" } });
    await runBroadcastAction({ type: "play_now", assetId: "asset_yt" });

    seed({
      playout: { insertAssetId: "asset_vod", insertRequestedAt: "2026-10-01T00:12:39.000Z", insertStatus: "active" },
      assets: [youtubeItem, asset({ ...uncachedArchive, cacheStatus: "ready" })]
    });
    await runBroadcastAction({ type: "trigger_insert", assetId: "asset_yt" });

    expect(mockAppendAuditEvent).not.toHaveBeenCalledWith("playout.insert.dropped", expect.anything());
  });

  it("lets a managed Off win over an env On, as the playout resolves it", async () => {
    vi.stubEnv("TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK", "1");
    seed({ managedConfig: { vodCacheAllowRemoteFallback: "0" } });

    await expect(runBroadcastAction({ type: "play_now", assetId: "asset_vod" })).rejects.toThrow(/not downloaded yet/);
  });
});

describe("Force reconnect", () => {
  it("is refused under the relay: the uplink reconnects by itself", async () => {
    vi.stubEnv("STREAM247_RELAY_ENABLED", "1");
    seed({});

    await expect(runBroadcastAction({ type: "force_reconnect" })).rejects.toThrow(/uplink holds the Twitch connection and reconnects by itself/);
    expect(mockUpdatePlayoutRuntime).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });

  it("restarts the encoder into the reconnect window without the relay, as before", async () => {
    vi.stubEnv("STREAM247_RELAY_ENABLED", "");
    seed({});

    await runBroadcastAction({ type: "force_reconnect" });

    expect(lastWrite().status).toBe("reconnecting");
    expect(lastWrite().restartRequestedAt).not.toBe("");
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("broadcast.reconnect.requested", expect.any(String));
  });
});

describe("Recover outputs", () => {
  const staged = {
    id: "destination_primary",
    name: "Twitch",
    role: "primary",
    status: "recovering",
    notes: ""
  };

  it("under the relay rejoins the staged outputs and leaves the playout alone", async () => {
    vi.stubEnv("STREAM247_RELAY_ENABLED", "1");
    seed({ destinations: [staged] });

    await expect(runBroadcastAction({ type: "recover_outputs" })).resolves.toEqual({
      ok: true,
      message: "Twitch will rejoin on the next uplink cycle."
    });

    expect(mockUpdateDestinationRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "destination_primary", status: "ready", notes: expect.stringContaining("next uplink cycle") })
    );
    // No restart flag: under the relay it rejoined nothing and replayed the running item from 0.
    expect(mockUpdatePlayoutRuntime).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("broadcast.output-recovery.requested", expect.stringContaining("Twitch"));
  });

  it("without the relay rejoins them through a playout restart, as before", async () => {
    vi.stubEnv("STREAM247_RELAY_ENABLED", "");
    seed({ destinations: [staged] });

    await runBroadcastAction({ type: "recover_outputs" });

    expect(mockUpdateDestinationRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
    expect(lastWrite().restartRequestedAt).not.toBe("");
    expect(lastWrite().status).toBe("recovering");
  });
});

describe("Resume schedule", () => {
  const holding = {
    overrideMode: "asset",
    overrideAssetId: "asset_pin",
    overrideUntil: "2099-01-01T00:00:00.000Z",
    insertAssetId: "asset_yt",
    insertRequestedAt: "2026-10-01T00:12:39.000Z",
    insertStatus: "active",
    manualNextAssetId: "asset_next",
    skipAssetId: "asset_skip",
    skipUntil: "2099-01-01T00:00:00.000Z"
  };

  it.each([
    ["relay", "1", false],
    ["direct RTMP", "", true]
  ])("cancels an override and an insert (%s mode)", async (_mode, relayFlag, restarts) => {
    vi.stubEnv("STREAM247_RELAY_ENABLED", relayFlag);
    seed({ playout: holding });

    await runBroadcastAction({ type: "resume" });

    const written = lastWrite();
    expect(written).toMatchObject({
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      manualNextAssetId: "",
      skipAssetId: "",
      skipUntil: ""
    });
    // Under the relay the worker switches to the pool by itself; a restart would replay whatever the
    // schedule keeps on air from its beginning. Without the relay the slate-and-continue stays.
    expect(written.restartRequestedAt !== "").toBe(restarts);
    expect(written.status).toBe(restarts ? "recovering" : "running");
    // The insert had aired ("active"): cancelling it is not a drop.
    expect(mockAppendAuditEvent).not.toHaveBeenCalledWith("playout.insert.dropped", expect.anything());
  });

  it("records a Play now it cancels before it aired as dropped", async () => {
    seed({ playout: { insertAssetId: "asset_yt", insertRequestedAt: "2026-10-01T00:12:39.000Z", insertStatus: "pending" } });

    await runBroadcastAction({ type: "resume" });

    expect(lastWrite().insertStatus).toBe("");
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "playout.insert.dropped",
      "Insert YouTube item was dropped before it aired (cancelled by Resume schedule)."
    );
  });
});

describe.each([
  ["relay", "1", false],
  ["direct RTMP", "", true]
])("Pin and Fallback (%s mode)", (_mode, relayFlag, restarts) => {
  beforeEach(() => {
    vi.stubEnv("STREAM247_RELAY_ENABLED", relayFlag);
  });

  // Under the relay the override branch and the normal switch change the item at the next cycle; the
  // restart flag only started a pin of the item on air (the form preselects it) again from 0. Without the
  // relay the slate comes first, as before.
  it("Pin writes the override, with the restart flag only without the relay", async () => {
    seed({ assets: [youtubeItem, asset({ id: "asset_archive", title: "Archive" })] });

    await runBroadcastAction({ type: "override", assetId: "asset_archive", minutes: 30 });

    const written = lastWrite();
    expect(written).toMatchObject({ overrideMode: "asset", overrideAssetId: "asset_archive", desiredAssetId: "asset_archive" });
    expect(written.overrideUntil).not.toBe("");
    expect(written.restartRequestedAt !== "").toBe(restarts);
    expect(written.status).toBe(restarts ? "recovering" : "running");
  });

  it("Fallback writes the override, with the restart flag only without the relay", async () => {
    seed({ assets: [youtubeItem, asset({ id: "asset_fallback", title: "Fallback loop", isGlobalFallback: true })] });

    await runBroadcastAction({ type: "fallback" });

    const written = lastWrite();
    expect(written).toMatchObject({ overrideMode: "fallback", overrideAssetId: "asset_fallback" });
    expect(written.restartRequestedAt !== "").toBe(restarts);
    expect(written.status).toBe(restarts ? "recovering" : "running");
  });
});

describe.each([
  ["relay", "1"],
  ["direct RTMP", ""]
])("actions that still restart the playout (%s mode)", (_mode, relayFlag) => {
  beforeEach(() => {
    vi.stubEnv("STREAM247_RELAY_ENABLED", relayFlag);
  });

  it.each(["restart", "hard_reload"] as const)("%s sets the restart flag", async (type) => {
    seed({});

    await runBroadcastAction({ type });

    expect(lastWrite().restartRequestedAt).not.toBe("");
  });

  it("skip holds the running item out and sets the restart flag", async () => {
    seed({ assets: [asset({ id: "asset_archive", title: "Archive" })] });

    await runBroadcastAction({ type: "skip", minutes: 30 });

    expect(lastWrite()).toMatchObject({ skipAssetId: "asset_archive" });
    expect(lastWrite().restartRequestedAt).not.toBe("");
  });
});

// M78 (owner decision 2026-10-01). Before, the override arm ignored the skip hold: a Skip during a Pin or
// Fallback started the pinned item again from 0 (under the relay at once, without it after the slate),
// and only Resume took it off air.
describe.each([
  ["relay", "1"],
  ["direct RTMP", ""]
])("Skip during a Pin or Fallback (%s mode)", (_mode, relayFlag) => {
  beforeEach(() => {
    vi.stubEnv("STREAM247_RELAY_ENABLED", relayFlag);
  });

  it.each([
    ["Pin", "asset", "asset_archive"],
    ["Fallback", "fallback", "asset_fallback"]
  ])("ends the %s that holds the item on air and holds the item out", async (name, overrideMode, assetId) => {
    seed({
      playout: {
        currentAssetId: assetId,
        overrideMode,
        overrideAssetId: assetId,
        overrideUntil: "2099-01-01T00:00:00.000Z",
        selectionReasonCode: "operator_override"
      },
      assets: [
        youtubeItem,
        asset({ id: "asset_archive", title: "Archive" }),
        asset({ id: "asset_fallback", title: "Fallback loop", isGlobalFallback: true })
      ]
    });
    const title = assetId === "asset_archive" ? "Archive" : "Fallback loop";

    await expect(runBroadcastAction({ type: "skip", minutes: 30 })).resolves.toEqual({
      ok: true,
      message: `Current asset skipped and the ${name} ended.`
    });

    const written = lastWrite();
    // Back to the schedule: the override arm has nothing to pick, the skip hold keeps the item out of
    // the pool's pick, and the pool continues.
    expect(written).toMatchObject({
      desiredAssetId: "",
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      skipAssetId: assetId
    });
    expect(written.skipUntil).not.toBe("");
    // M74's Skip in both modes: the restart flag (with the relay no slate; without it the slate first).
    expect(written.restartRequestedAt).not.toBe("");
    expect(written.message).toBe(`Skipped ${title} for 30 minutes and ended the ${name}.`);
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "playout.skip.current",
      `Skipped ${title} for 30 minutes; the ${name} was ended by Skip.`
    );
  });

  it("leaves a Pin the playout has not switched to yet: the operator skipped the item before it", async () => {
    seed({
      playout: { overrideMode: "asset", overrideAssetId: "asset_yt", overrideUntil: "2099-01-01T00:00:00.000Z" },
      assets: [youtubeItem, asset({ id: "asset_archive", title: "Archive" })]
    });

    await expect(runBroadcastAction({ type: "skip", minutes: 30 })).resolves.toEqual({ ok: true, message: "Current asset skipped." });

    expect(lastWrite()).toMatchObject({ overrideMode: "asset", overrideAssetId: "asset_yt", skipAssetId: "asset_archive" });
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("playout.skip.current", "Skipped Archive for 30 minutes.");
  });

  it("without an override writes what it wrote before M78", async () => {
    seed({ assets: [asset({ id: "asset_archive", title: "Archive" })] });

    await expect(runBroadcastAction({ type: "skip", minutes: 30 })).resolves.toEqual({ ok: true, message: "Current asset skipped." });

    expect(lastWrite()).toMatchObject({
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      skipAssetId: "asset_archive",
      status: "recovering",
      message: "Skipped Archive for 30 minutes."
    });
    expect(lastWrite().restartRequestedAt).not.toBe("");
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("playout.skip.current", "Skipped Archive for 30 minutes.");
  });

  it("does not end a newer override of another item written since the Skip read the row", async () => {
    seed({
      playout: {
        currentAssetId: "asset_archive",
        overrideMode: "asset",
        overrideAssetId: "asset_archive",
        overrideUntil: "2099-01-01T00:00:00.000Z"
      },
      assets: [youtubeItem, asset({ id: "asset_archive", title: "Archive" })]
    });
    // The operator pins another item between the read and the write.
    runtime = { ...runtime, overrideAssetId: "asset_yt" };

    // The toast, the message and the audit row follow the write: the Pin of asset_yt still holds the air.
    await expect(runBroadcastAction({ type: "skip", minutes: 30 })).resolves.toEqual({ ok: true, message: "Current asset skipped." });

    expect(lastWrite()).toMatchObject({
      overrideMode: "asset",
      overrideAssetId: "asset_yt",
      skipAssetId: "asset_archive",
      message: "Skipped Archive for 30 minutes."
    });
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("playout.skip.current", "Skipped Archive for 30 minutes.");
  });

  it.each([
    ["Pin", { type: "override", assetId: "asset_archive", minutes: 30 } as const, "asset_archive"],
    ["Fallback", { type: "fallback" } as const, "asset_fallback"]
  ])("%s of an item a Skip holds out lifts the hold, or the override arm would leave it out", async (_name, action, assetId) => {
    seed({
      playout: { skipAssetId: assetId, skipUntil: "2099-01-01T00:00:00.000Z" },
      assets: [
        youtubeItem,
        asset({ id: "asset_archive", title: "Archive" }),
        asset({ id: "asset_fallback", title: "Fallback loop", isGlobalFallback: true })
      ]
    });

    await runBroadcastAction(action);

    expect(lastWrite()).toMatchObject({ overrideAssetId: assetId, skipAssetId: "", skipUntil: "" });
  });

  it("a Pin keeps a skip hold on another item", async () => {
    seed({
      playout: { skipAssetId: "asset_yt", skipUntil: "2099-01-01T00:00:00.000Z" },
      assets: [youtubeItem, asset({ id: "asset_archive", title: "Archive" })]
    });

    await runBroadcastAction({ type: "override", assetId: "asset_archive", minutes: 30 });

    expect(lastWrite()).toMatchObject({ overrideAssetId: "asset_archive", skipAssetId: "asset_yt" });
  });
});
