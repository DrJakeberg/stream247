import { describe, expect, it } from "vitest";
import {
  decideBoundaryPlaybackInput,
  isBroadcastCoverageDown,
  isImmediateInputOpenFailure,
  shouldBridgeToFallbackBeforeResolve
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
