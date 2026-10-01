import { describe, expect, it } from "vitest";
import {
  ITEM_ENDING_STOP_REASONS,
  decideBoundaryPlaybackInput,
  decideCycleEndInsert,
  decideInsertAfterPrepareFailure,
  decideInsertAfterSelection,
  decidePreviousAssetId,
  isBroadcastCoverageDown,
  isImmediateInputOpenFailure,
  runningAssetTargetMatches,
  selectionTakesPoolPosition,
  shouldBridgeToFallbackBeforeResolve,
  shouldClearInsertOnExit,
  shouldKeepRunningInput,
  shouldShowReconnectSlate
} from "../../apps/worker/src/playout-boundary";

describe("playout boundary input selection", () => {
  // Regression for the v1.5.10 CLEAN4 soak failure: a natural-boundary exit selected the
  // next scheduled asset, but the boundary resolved its input inline (Twitch-VOD cache /
  // yt-dlp), leaving playout idle with an empty currentAsset and broadcastReady=false until
  // the resolve completed. When the next asset was already prefetched, the boundary must
  // reuse that resolved input and NOT trigger an inline resolve.
  it("reuses the prefetched resolved input when the probe is fresh-ready (no inline resolve)", () => {
    const decision = decideBoundaryPlaybackInput(
      {
        status: "ready",
        resolvedInput: "https://cdn.example/vod/720p.m3u8",
        assetId: "asset_next"
      },
      "asset_next"
    );

    expect(decision.source).toBe("cache");
    expect(decision.input).toBe("https://cdn.example/vod/720p.m3u8");
  });

  it("falls through to an inline resolve when there is no probe (stale/missing TTL)", () => {
    const decision = decideBoundaryPlaybackInput(null, "asset_next");

    expect(decision.source).toBe("resolve");
    expect(decision.input).toBe("");
  });

  it("falls through to an inline resolve when the probe failed", () => {
    const decision = decideBoundaryPlaybackInput({ status: "failed", resolvedInput: "", assetId: "asset_next" }, "asset_next");

    expect(decision.source).toBe("resolve");
  });

  it("falls through to an inline resolve when a ready probe carries no resolved input", () => {
    const decision = decideBoundaryPlaybackInput({ status: "ready", resolvedInput: "", assetId: "asset_next" }, "asset_next");

    expect(decision.source).toBe("resolve");
  });
});

describe("stale prefetch never redirects the boundary", () => {
  // The dangerous failure direction. A prefetch resolved for the asset the queue *used* to point
  // at must never supply the input for whatever the cycle actually selected after a skip vote,
  // operator insert, schedule flip or chapter jump changed the queue. Declining the prefetch costs
  // a few seconds of fallback; honouring it would put the wrong programme on air.
  it("ignores a ready probe that belongs to a different asset", () => {
    const decision = decideBoundaryPlaybackInput(
      {
        status: "ready",
        resolvedInput: "https://cdn.example/previously-queued.m3u8",
        assetId: "asset_stale"
      },
      "asset_selected_after_skip_vote"
    );

    expect(decision.source).toBe("resolve");
    // The stale input must not leak through under any circumstance.
    expect(decision.input).toBe("");
  });

  it("ignores a probe with no asset attribution", () => {
    const decision = decideBoundaryPlaybackInput(
      { status: "ready", resolvedInput: "https://cdn.example/unattributed.m3u8", assetId: "" },
      "asset_selected"
    );

    expect(decision.source).toBe("resolve");
  });

  it("refuses to use any probe when the cycle has no selected asset id", () => {
    const decision = decideBoundaryPlaybackInput(
      { status: "ready", resolvedInput: "https://cdn.example/vod.m3u8", assetId: "asset_next" },
      ""
    );

    expect(decision.source).toBe("resolve");
  });
});

describe("immediate input-open failure detection (A)", () => {
  // Regression for the v1.5.13 soak failure: a scheduled YouTube asset started with a dead/
  // expired resolved googlevideo URL and ffmpeg exited in ~0.3s with exitCode=8 / "Error opening
  // input file". That asset's resolved-input cache must be invalidated so the next attempt
  // re-resolves a fresh URL instead of reusing the dead one.
  it("flags exitCode=8 shortly after start as an immediate open failure", () => {
    expect(
      isImmediateInputOpenFailure({ exitCode: 8, exitSignal: "", stderrSample: "", ranForMs: 300 })
    ).toBe(true);
  });

  it("flags an 'Error opening input' stderr as an immediate open failure", () => {
    expect(
      isImmediateInputOpenFailure({
        exitCode: 1,
        exitSignal: "",
        stderrSample: "Error opening input file https://rr4---sn-...googlevideo.com/...",
        ranForMs: 250
      })
    ).toBe(true);
  });

  it("flags HTTP 403/404/410 open errors", () => {
    for (const sample of ["Server returned 403 Forbidden", "HTTP error 404 Not Found", "410 Gone"]) {
      expect(
        isImmediateInputOpenFailure({ exitCode: 1, exitSignal: "", stderrSample: sample, ranForMs: 500 })
      ).toBe(true);
    }
  });

  it("does NOT flag a signal-terminated (planned/forced) stop", () => {
    expect(
      isImmediateInputOpenFailure({ exitCode: null, exitSignal: "SIGKILL", stderrSample: "Error opening input", ranForMs: 100 })
    ).toBe(false);
  });

  it("does NOT flag an open-error code that occurred after long successful playback", () => {
    expect(
      isImmediateInputOpenFailure({ exitCode: 8, exitSignal: "", stderrSample: "", ranForMs: 6 * 60 * 1000 })
    ).toBe(false);
  });

  it("does NOT flag a clean exit (code 0)", () => {
    expect(
      isImmediateInputOpenFailure({ exitCode: 0, exitSignal: "", stderrSample: "", ranForMs: 200 })
    ).toBe(false);
  });

  it("treats unknown runtime as immediate (cannot prove it played)", () => {
    expect(
      isImmediateInputOpenFailure({ exitCode: 8, exitSignal: "", stderrSample: "", ranForMs: null })
    ).toBe(true);
  });
});

describe("boundary fallback bridge decision (B)", () => {
  // Regression for the v1.5.13 soak failure: after the dead-URL ffmpeg failure, the worker failed
  // over to a cold Twitch VOD whose inline cache-prep + remote resolve took ~2 minutes, leaving
  // broadcastReady=false the whole time. When broadcast is down and the next scheduled asset needs
  // a cold expensive resolve, bridge to the instant local fallback first.
  it("bridges when broadcast is down, asset is expensive+cold, and a fallback exists", () => {
    expect(
      shouldBridgeToFallbackBeforeResolve({
        assetExpensive: true,
        cacheWarm: false,
        broadcastDown: true,
        fallbackAvailable: true
      })
    ).toBe(true);
  });

  it("does NOT bridge on a clean boundary (broadcast still coasting on the feed buffer)", () => {
    expect(
      shouldBridgeToFallbackBeforeResolve({
        assetExpensive: true,
        cacheWarm: false,
        broadcastDown: false,
        fallbackAvailable: true
      })
    ).toBe(false);
  });

  it("does NOT bridge when the asset is already warm in cache (no cold resolve needed)", () => {
    expect(
      shouldBridgeToFallbackBeforeResolve({
        assetExpensive: true,
        cacheWarm: true,
        broadcastDown: true,
        fallbackAvailable: true
      })
    ).toBe(false);
  });

  it("does NOT bridge for a cheap/local asset (resolve is instant — no gap to bridge)", () => {
    expect(
      shouldBridgeToFallbackBeforeResolve({
        assetExpensive: false,
        cacheWarm: false,
        broadcastDown: true,
        fallbackAvailable: true
      })
    ).toBe(false);
  });

  it("does NOT bridge when no fallback asset is available", () => {
    expect(
      shouldBridgeToFallbackBeforeResolve({
        assetExpensive: true,
        cacheWarm: false,
        broadcastDown: true,
        fallbackAvailable: false
      })
    ).toBe(false);
  });
});

describe("broadcast coverage detection (clean-boundary bridge)", () => {
  // Regression for the v1.5.14-soak failure: global_fallback exited cleanly (naturalBoundary),
  // the next scheduled Twitch VOD was cold, and the ~93s inline resolve ran with NO playout
  // process — the ~60s feed buffer drained and programFeed went stale. Coverage must be treated
  // as "down" on a clean boundary (no running process), not only after a failed exit.
  it("reports coverage down when no playout process is running (clean boundary OR failure)", () => {
    expect(isBroadcastCoverageDown({ playoutProcessRunning: false })).toBe(true);
  });

  it("reports coverage up while a playout process is running (steady state / fallback covering)", () => {
    expect(isBroadcastCoverageDown({ playoutProcessRunning: true })).toBe(false);
  });

  it("clean boundary → cold expensive scheduled asset → bridges (the exact v1.5.14-soak shape)", () => {
    // global_fallback just ended cleanly: no process running → coverage down.
    const broadcastDown = isBroadcastCoverageDown({ playoutProcessRunning: false });
    expect(broadcastDown).toBe(true);
    expect(
      shouldBridgeToFallbackBeforeResolve({
        assetExpensive: true, // cold Twitch VOD
        cacheWarm: false,
        broadcastDown,
        fallbackAvailable: true
      })
    ).toBe(true);
  });

  it("after the bridge (fallback running) → cold resolve proceeds inline, no second bridge", () => {
    // Next cycle: fallback is now the running process → coverage up → resolve inline while the
    // live fallback feed covers; no further bridge, no no-playout gap.
    const broadcastDown = isBroadcastCoverageDown({ playoutProcessRunning: true });
    expect(broadcastDown).toBe(false);
    expect(
      shouldBridgeToFallbackBeforeResolve({
        assetExpensive: true,
        cacheWarm: false,
        broadcastDown,
        fallbackAvailable: true
      })
    ).toBe(false);
  });

  it("steady-state healthy playback (process running, warm asset) → no bridge, no behavior change", () => {
    // A long-running scheduled asset re-selected with a warm cache never reaches the bridge path;
    // even if evaluated, a running process means coverage is up.
    expect(isBroadcastCoverageDown({ playoutProcessRunning: true })).toBe(false);
  });
});

// 2.1: a YouTube programme can be a video+audio pair. The boundary must hand out the pair as a unit:
// reusing a cached video URL with no audio, or with another probe's audio, would put a silent or
// mismatched programme on air.
describe("boundary reuse of a video+audio pair", () => {
  const pairProbe = {
    status: "ready" as const,
    resolvedInput: "https://googlevideo.test/videoplayback?itag=299",
    resolvedAudioInput: "https://googlevideo.test/videoplayback?itag=140",
    assetId: "asset_source_jjwuu0f3_j4YdbIbEc9E"
  };

  it("reuses the audio track together with the video track", () => {
    expect(decideBoundaryPlaybackInput(pairProbe, pairProbe.assetId)).toEqual({
      source: "cache",
      input: pairProbe.resolvedInput,
      audioInput: pairProbe.resolvedAudioInput
    });
  });

  it("reports no audio track for a single-file probe", () => {
    const single = { status: "ready" as const, resolvedInput: "/app/data/media/a.mp4", assetId: "asset_local" };
    expect(decideBoundaryPlaybackInput(single, "asset_local").audioInput).toBe("");
  });

  it("drops the audio track together with the video track when the probe is not used", () => {
    expect(decideBoundaryPlaybackInput(pairProbe, "asset_other")).toEqual({ source: "resolve", input: "", audioInput: "" });
    expect(decideBoundaryPlaybackInput({ ...pairProbe, status: "failed" }, pairProbe.assetId).audioInput).toBe("");
  });
});

// M68 (2.1): the cycle re-resolved the asset on air every 15 s and a failed re-resolve switched it
// to the global fallback -- seven of nine YouTube runs on 2026-09-28 lasted exactly 18 s.
describe("keeping the running programme's input", () => {
  it.each([
    // processRunning, targetMatches, restartRequested -> keep
    [true, true, false, true],
    [false, true, false, false],
    [true, false, false, false],
    [true, true, true, false],
    [false, false, true, false]
  ])("running=%s matches=%s restart=%s -> keep=%s", (processRunning, targetMatches, restartRequested, keep) => {
    expect(shouldKeepRunningInput({ processRunning, targetMatches, restartRequested })).toBe(keep);
  });
});

describe("reconnect slate only without the relay (M74)", () => {
  it.each([
    // relayEnabled, liveBridgeActive, reconnectActive, restartRequested -> slate
    // The DUT on 2026-10-01: relay on, a Play now set the restart flag, 18 s of slate. Never again.
    [true, false, false, true, false],
    [true, false, false, false, false],
    // reconnectActive is false under the relay by construction (4043eb6); even if it were not, the
    // slate would still be a direct-mode device -- kept as the caller computes it.
    [true, false, true, false, true],
    // Direct RTMP mode keeps today's behaviour: every restart, and the reconnect window, show the slate.
    [false, false, false, true, true],
    [false, false, true, false, true],
    [false, false, true, true, true],
    [false, false, false, false, false],
    // A live bridge on air is never covered by the slate.
    [false, true, true, true, false],
    [true, true, false, true, false]
  ])("relay=%s bridge=%s reconnect=%s restart=%s -> slate=%s", (relayEnabled, liveBridgeActive, reconnectActive, restartRequested, slate) => {
    expect(shouldShowReconnectSlate({ relayEnabled, liveBridgeActive, reconnectActive, restartRequested })).toBe(slate);
  });
});

describe("clearing an operator insert when its process exits (M74)", () => {
  const active = { insertStatus: "active", insertAssetId: "asset_insert", currentAssetId: "asset_insert" };

  it.each([
    // plannedReason -> clear
    ["", true], // natural EOF or a crash: as before
    ["duration-bound", true], // a remote VOD without EOF, several times a day -- used to replay from 0
    ["feed-stalled", true],
    ["feed-audio-stalled", true],
    ["switch", false], // something else starts right after; the selection decides about the insert
    ["restart-requested", false], // Restart replays the insert
    ["scheduled-reconnect", false],
    ["destination-missing", false]
  ])("plannedReason=%j -> clear=%s", (plannedReason, clear) => {
    expect(shouldClearInsertOnExit({ ...active, plannedReason })).toBe(clear);
  });

  it("names exactly the stops that end an item for good", () => {
    expect([...ITEM_ENDING_STOP_REASONS].sort()).toEqual(["duration-bound", "feed-audio-stalled", "feed-stalled"]);
  });

  it("leaves a pending insert alone: it has not aired yet", () => {
    expect(shouldClearInsertOnExit({ ...active, insertStatus: "pending", plannedReason: "duration-bound" })).toBe(false);
    expect(shouldClearInsertOnExit({ ...active, insertStatus: "pending", plannedReason: "" })).toBe(false);
  });

  it("leaves the insert alone when the exiting process played something else", () => {
    expect(shouldClearInsertOnExit({ ...active, currentAssetId: "asset_archive", plannedReason: "duration-bound" })).toBe(false);
    expect(shouldClearInsertOnExit({ ...active, currentAssetId: "asset_archive", plannedReason: "" })).toBe(false);
  });
});

describe("the operator insert after the selection (M74, Live Bridge since M78)", () => {
  it.each([
    // insertStatus, selectionReasonCode, live, available -> clear, dropReason
    ["", "scheduled_match", false, true, false, ""], // no insert
    ["pending", "operator_insert", false, true, false, ""], // the selection is the insert
    ["active", "operator_insert", false, true, false, ""],
    ["pending", "operator_override", false, true, true, "preempted"], // a Pin or Fallback comes first
    ["pending", "scheduled_match", false, false, true, "unavailable"], // not ready, or skip-held
    ["active", "operator_override", false, true, true, ""], // it aired: ended, not dropped
    ["active", "scheduled_match", false, false, true, ""], // a Skip of the insert on air
    // M78: the takeover ends the insert. Before, the insert on air started again from 0 after the
    // release, and a pending Play now aired whenever the bridge was released.
    ["pending", "live_bridge", true, true, true, "live-bridge"],
    ["pending", "live_bridge", true, false, true, "live-bridge"],
    ["active", "live_bridge", true, true, true, ""]
  ] as const)(
    "insertStatus=%j selection=%s live=%s available=%s -> clear=%s dropReason=%j",
    (insertStatus, selectionReasonCode, selectionIsLive, insertAvailable, clear, dropReason) => {
      expect(decideInsertAfterSelection({ insertStatus, selectionReasonCode, selectionIsLive, insertAvailable })).toEqual({
        clear,
        dropReason
      });
    }
  );
});

describe("the operator insert that cannot be prepared (M74, an aired one since the combination review)", () => {
  it.each([
    // reasonCode, insertStatus, processRunning, currentAssetId -> decision (the insert is asset_insert)
    // M74: a pending insert is dropped and the item on air stays.
    ["operator_insert", "pending", true, "asset_on_air", "drop"],
    // Nothing on air: the recovery plan runs, so the channel is not left dark.
    ["operator_insert", "pending", false, "", "recover"],
    ["operator_insert", "pending", true, "", "recover"],
    ["operator_insert", "pending", false, "asset_on_air", "recover"],
    // The insert on air fails to prepare for a Restart: the programme's failure, the recovery plan covers it.
    ["operator_insert", "active", true, "asset_insert", "recover"],
    // The cycle after: the fallback is on air and the row still says active. Selected and resolved again
    // on every cycle before, with the fallback on air until Resume; now the insert is ended.
    ["operator_insert", "active", true, "asset_fallback", "end"],
    ["operator_insert", "active", false, "asset_fallback", "recover"],
    ["operator_insert", "active", true, "", "recover"],
    // Any other selection that fails to prepare is the programme's.
    ["scheduled_match", "", true, "asset_on_air", "recover"],
    ["scheduled_match", "active", true, "asset_fallback", "recover"],
    ["operator_insert", "", true, "asset_on_air", "recover"]
  ] as const)(
    "selection=%s insertStatus=%j processRunning=%s onAir=%j -> %s",
    (selectionReasonCode, insertStatus, processRunning, currentAssetId, expected) => {
      expect(
        decideInsertAfterPrepareFailure({ selectionReasonCode, insertStatus, insertAssetId: "asset_insert", processRunning, currentAssetId })
      ).toBe(expected);
    }
  );

  it("ends the row that neither the Restart's stop nor the recovery cycle's end clears", () => {
    // The stop of a Restart keeps an insert on air (it starts again), and the recovery's fallback is not
    // an operator_insert selection, so both writes leave the insert active: this decision is its only end.
    expect(
      shouldClearInsertOnExit({ plannedReason: "restart-requested", insertStatus: "active", insertAssetId: "asset_insert", currentAssetId: "asset_insert" })
    ).toBe(false);
    const row = { insertAssetId: "asset_insert", insertRequestedAt: "2026-10-01T12:00:00.000Z", insertStatus: "active" } as const;
    expect(decideCycleEndInsert({ selectionIsOperatorInsert: false, selectedAssetId: "asset_fallback", row, now: "2026-10-01T12:05:00.000Z" })).toEqual(row);
    // The next cycle selects the insert again (decideInsertAfterSelection keeps what the selection names).
    expect(decideInsertAfterSelection({ insertStatus: "active", selectionReasonCode: "operator_insert", selectionIsLive: false, insertAvailable: true })).toEqual({ clear: false, dropReason: "" });
    expect(
      decideInsertAfterPrepareFailure({
        selectionReasonCode: "operator_insert",
        insertStatus: row.insertStatus,
        insertAssetId: row.insertAssetId,
        processRunning: true,
        currentAssetId: "asset_fallback"
      })
    ).toBe("end");
  });
});

describe("the asset Replay previous offers (M74)", () => {
  const base = { onAirAtCycleStart: "", lastEndedAssetId: "", incomingAssetId: "", incomingIsLive: false, previousAssetId: "" };

  it("records the item a Play now switched away from", () => {
    // The cycle-end row already names the insert; the outgoing archive is what was on air at the start.
    expect(decidePreviousAssetId({ ...base, onAirAtCycleStart: "asset_archive", incomingAssetId: "asset_insert" })).toBe("asset_archive");
  });

  it("records the item a natural end (or the duration bound) has just cleared", () => {
    expect(decidePreviousAssetId({ ...base, lastEndedAssetId: "asset_a", incomingAssetId: "asset_b", previousAssetId: "asset_z" })).toBe(
      "asset_a"
    );
  });

  it("prefers what was on air over an older ended item", () => {
    expect(
      decidePreviousAssetId({ ...base, onAirAtCycleStart: "asset_b", lastEndedAssetId: "asset_a", incomingAssetId: "asset_c" })
    ).toBe("asset_b");
  });

  it("keeps the previous asset while the same item runs or restarts", () => {
    expect(
      decidePreviousAssetId({ ...base, onAirAtCycleStart: "asset_b", lastEndedAssetId: "asset_a", incomingAssetId: "asset_b", previousAssetId: "asset_a" })
    ).toBe("asset_a");
    // A single-item pool that loops: the item ended and starts again.
    expect(decidePreviousAssetId({ ...base, lastEndedAssetId: "asset_b", incomingAssetId: "asset_b", previousAssetId: "asset_a" })).toBe("asset_a");
  });

  it("keeps the previous asset for a slate and records the outgoing item for a live bridge", () => {
    expect(decidePreviousAssetId({ ...base, onAirAtCycleStart: "asset_b", incomingAssetId: "", previousAssetId: "asset_a" })).toBe("asset_a");
    expect(decidePreviousAssetId({ ...base, onAirAtCycleStart: "asset_b", incomingIsLive: true, previousAssetId: "asset_a" })).toBe("asset_b");
  });

  it("has nothing to record when nothing was on air and nothing ended", () => {
    expect(decidePreviousAssetId({ ...base, incomingAssetId: "asset_b", previousAssetId: "asset_a" })).toBe("asset_a");
  });
});

describe("the running item a selection names (M74 review)", () => {
  it.each([
    // desiredKind, desiredAssetId, runningKind, runningAssetId -> keeps running
    ["asset", "asset_a", "asset", "asset_a", true],
    ["insert", "asset_y", "insert", "asset_y", true],
    // Resume of a Play now of the pool's next item: the pool picks the insert's item, which runs on
    // instead of being cut and started again from 0. Also a Pin of the insert on air.
    ["asset", "asset_y", "insert", "asset_y", true],
    // An item on air as itself is not an insert of itself (the admin refuses that Play now).
    ["insert", "asset_a", "asset", "asset_a", false],
    ["asset", "asset_b", "asset", "asset_a", false],
    ["asset", "asset_b", "insert", "asset_a", false],
    ["asset", "asset_a", "standby", "", false],
    ["asset", "", "asset", "", false]
  ] as const)("desired %s %s, running %s %s -> %s", (desiredKind, desiredAssetId, runningKind, runningAssetId, matches) => {
    expect(runningAssetTargetMatches({ desiredKind, desiredAssetId, runningKind, runningAssetId })).toBe(matches);
  });
});

describe("the pool position a selection takes (M73, M74 review)", () => {
  it.each([
    // selection, selected, on air, on-air reason -> takes the position
    ["scheduled_match", "asset_b", "asset_a", "scheduled_match", true], // the pool starts its next item
    ["scheduled_match", "asset_b", "", "", true], // after a natural end
    ["scheduled_match", "asset_a", "asset_a", "scheduled_match", false], // runs on
    ["scheduled_match", "asset_a", "asset_a", "manual_next", false], // a Move next of a pool item runs on
    ["scheduled_match", "asset_a", "asset_a", "graceful_handoff", false],
    // Resume of a Play now of exactly the pool's next item: the pool picked it from its position, so the
    // position moves to it; otherwise it played a third time after its end.
    ["scheduled_match", "asset_y", "asset_y", "operator_insert", true],
    ["operator_insert", "asset_y", "asset_a", "scheduled_match", false],
    ["manual_next", "asset_m", "asset_a", "scheduled_match", false],
    ["scheduled_insert", "asset_i", "", "", false],
    ["scheduled_match", "", "asset_a", "scheduled_match", false]
  ])("%s %s with %s (%s) on air -> %s", (selectionReasonCode, selectedAssetId, runtimeCurrentAssetId, runtimeReasonCode, takes) => {
    expect(selectionTakesPoolPosition({ selectionReasonCode, selectedAssetId, runtimeCurrentAssetId, runtimeReasonCode })).toBe(takes);
  });
});

describe("the insert fields the cycle's end leaves (M74 review)", () => {
  const now = "2026-10-01T00:13:00.000Z";
  const pendingY = { insertAssetId: "asset_y", insertRequestedAt: "2026-10-01T00:12:39.000Z", insertStatus: "pending" };

  it("marks the insert this cycle started active", () => {
    expect(decideCycleEndInsert({ selectionIsOperatorInsert: true, selectedAssetId: "asset_y", row: pendingY, now })).toEqual({
      ...pendingY,
      insertStatus: "active"
    });
    expect(
      decideCycleEndInsert({ selectionIsOperatorInsert: true, selectedAssetId: "asset_y", row: { ...pendingY, insertRequestedAt: "" }, now })
        .insertRequestedAt
    ).toBe(now);
  });

  it("keeps a Resume that cancelled the insert while the cycle ran", () => {
    const cleared = { insertAssetId: "", insertRequestedAt: "", insertStatus: "" };
    expect(decideCycleEndInsert({ selectionIsOperatorInsert: true, selectedAssetId: "asset_y", row: cleared, now })).toEqual(cleared);
  });

  it("keeps a newer Play now pending for the next cycle", () => {
    const pendingZ = { insertAssetId: "asset_z", insertRequestedAt: "2026-10-01T00:12:50.000Z", insertStatus: "pending" };
    expect(decideCycleEndInsert({ selectionIsOperatorInsert: true, selectedAssetId: "asset_y", row: pendingZ, now })).toEqual(pendingZ);
  });

  it("leaves the row alone for any other selection, also a slate", () => {
    expect(decideCycleEndInsert({ selectionIsOperatorInsert: false, selectedAssetId: "asset_a", row: pendingY, now })).toEqual(pendingY);
    expect(decideCycleEndInsert({ selectionIsOperatorInsert: false, selectedAssetId: "", row: pendingY, now })).toEqual(pendingY);
  });
});
