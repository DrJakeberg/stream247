import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPLINK_GRACE_MS,
  DEFAULT_UPLINK_NO_PROGRESS_RESTART_MS,
  DEFAULT_DISCONTINUITY_LIMIT,
  canBlameUplinkForStall,
  createUplinkDiscontinuityState,
  isDiscontinuityStorm,
  isTimestampDiscontinuityLine,
  observeDiscontinuityLine,
  DEFAULT_UPLINK_STALL_MS,
  createUplinkProgressState,
  getUplinkStallOptions,
  hasNeverProgressed,
  isUplinkStalled,
  shouldRestartForNoProgress,
  observeUplinkProgress,
  pickUplinkGroupStartedAt
} from "../../apps/worker/src/uplink-progress.js";

// The outage this guards against: the uplink ffmpeg stayed alive at 0.02% CPU, encoded nothing, and
// pulled audio and video apart while every health surface reported "ok". Process liveness could not
// tell "running" from "working"; out_time can.

const OPTIONS = { stallMs: 45_000, graceMs: 60_000, noProgressRestartMs: 300_000 };

/** A real -progress block, as ffmpeg writes it. */
function progressBlock(outTimeUs: number): string {
  return [
    "bitrate=4498.1kbits/s",
    "total_size=2621440",
    `out_time_us=${outTimeUs}`,
    `out_time_ms=${outTimeUs}`,
    `out_time=${new Date(outTimeUs / 1000).toISOString().slice(11, 23)}`,
    "dup_frames=0",
    "drop_frames=0",
    "speed=1.0x",
    "progress=continue",
    ""
  ].join("\n");
}

describe("uplink stall detection", () => {
  it("treats advancing out_time as healthy", () => {
    let state = createUplinkProgressState(0);
    state = observeUplinkProgress(state, progressBlock(2_000_000), 100_000);
    state = observeUplinkProgress(state, progressBlock(4_000_000), 102_000);

    expect(isUplinkStalled(state, 103_000, 0, OPTIONS)).toBe(false);
  });

  it("reports a stall once out_time stops advancing", () => {
    let state = createUplinkProgressState(0);
    state = observeUplinkProgress(state, progressBlock(2_000_000), 100_000);

    expect(isUplinkStalled(state, 100_000 + OPTIONS.stallMs - 1, 0, OPTIONS)).toBe(false);
    expect(isUplinkStalled(state, 100_000 + OPTIONS.stallMs, 0, OPTIONS)).toBe(true);
  });

  it("does not count repeated identical progress blocks as advancing", () => {
    // ffmpeg keeps emitting blocks while stuck; the timestamp inside them is what matters.
    let state = createUplinkProgressState(0);
    state = observeUplinkProgress(state, progressBlock(2_000_000), 100_000);
    for (let at = 101_000; at <= 160_000; at += 1_000) {
      state = observeUplinkProgress(state, progressBlock(2_000_000), at);
    }

    expect(isUplinkStalled(state, 160_000, 0, OPTIONS)).toBe(true);
  });

  it("stays silent during the grace period", () => {
    let state = createUplinkProgressState(0);
    state = observeUplinkProgress(state, progressBlock(1_000), 1_000);

    expect(isUplinkStalled(state, OPTIONS.graceMs - 1, 0, OPTIONS)).toBe(false);
  });

  it("does not treat a process that has not reported progress yet as stalled", () => {
    // The stall verdict measures a timestamp that stopped advancing; there is nothing to measure
    // until the first frame. That case belongs to the no-progress path below.
    const state = createUplinkProgressState(0);

    expect(isUplinkStalled(state, 10 * 60_000, 0, OPTIONS)).toBe(false);
    expect(hasNeverProgressed(state, 10 * 60_000, 0, OPTIONS)).toBe(true);
  });

  it("restarts an uplink that has never encoded a frame, once no benign reason is left", () => {
    // Observed in production: 65 minutes running, not one frame, no RTMP connection, this state
    // logged every 15 seconds while the channel was off the air. It used to be reported only.
    const state = createUplinkProgressState(0);

    // A slow connect resolves far inside the threshold, so nothing happens there.
    expect(shouldRestartForNoProgress(state, 90_000, 0, OPTIONS)).toBe(false);
    expect(shouldRestartForNoProgress(state, OPTIONS.noProgressRestartMs - 1, 0, OPTIONS)).toBe(false);

    expect(shouldRestartForNoProgress(state, OPTIONS.noProgressRestartMs, 0, OPTIONS)).toBe(true);
    expect(shouldRestartForNoProgress(state, 65 * 60_000, 0, OPTIONS)).toBe(true);
  });

  it("leaves a working uplink alone however long it runs", () => {
    let state = createUplinkProgressState(0);
    state = observeUplinkProgress(state, progressBlock(2_000_000), 1_000);

    expect(shouldRestartForNoProgress(state, 65 * 60_000, 0, OPTIONS)).toBe(false);
  });

  it("reassembles progress lines split across chunk boundaries", () => {
    // The stdout pipe splits wherever it likes; a truncated number must not be parsed.
    let state = createUplinkProgressState(0);
    state = observeUplinkProgress(state, "out_time_us=123", 1_000);
    expect(state.seenProgress).toBe(false);

    state = observeUplinkProgress(state, "4567\nprogress=continue\n", 2_000);
    expect(state.seenProgress).toBe(true);
    expect(state.lastValue).toBe(1_234_567);
  });

  it("ignores malformed and non-monotonic values", () => {
    let state = createUplinkProgressState(0);
    state = observeUplinkProgress(state, progressBlock(5_000_000), 100_000);
    const advancedAt = state.lastAdvanceAtMs;

    state = observeUplinkProgress(state, "out_time_us=N/A\n", 110_000);
    state = observeUplinkProgress(state, "out_time_us=-1\n", 111_000);
    state = observeUplinkProgress(state, progressBlock(1_000_000), 112_000);

    expect(state.lastValue).toBe(5_000_000);
    expect(state.lastAdvanceAtMs).toBe(advancedAt);
  });

  it("does not blame the uplink for a feed that has stopped producing", () => {
    // Otherwise a playout outage becomes an uplink restart loop that lasts exactly as long as the
    // outage, and never fixes anything on the way.
    expect(canBlameUplinkForStall("hls", "fresh")).toBe(true);
    for (const status of ["", "bootstrapping", "stale", "failed"]) {
      expect(canBlameUplinkForStall("hls", status)).toBe(false);
    }
    // A relay input does not depend on the program feed at all.
    for (const status of ["", "stale", "failed"]) {
      expect(canBlameUplinkForStall("rtmp", status)).toBe(true);
    }
  });

  it("reads thresholds from the environment with usable defaults", () => {
    expect(getUplinkStallOptions({} as NodeJS.ProcessEnv)).toEqual({
      stallMs: DEFAULT_UPLINK_STALL_MS,
      graceMs: DEFAULT_UPLINK_GRACE_MS,
      noProgressRestartMs: DEFAULT_UPLINK_NO_PROGRESS_RESTART_MS
    });
    expect(
      getUplinkStallOptions({ UPLINK_STALL_TIMEOUT_MS: "20000", UPLINK_STALL_GRACE_MS: "5000" } as NodeJS.ProcessEnv)
    ).toEqual({ stallMs: 20_000, graceMs: 5_000, noProgressRestartMs: DEFAULT_UPLINK_NO_PROGRESS_RESTART_MS });
    expect(getUplinkStallOptions({ UPLINK_STALL_TIMEOUT_MS: "0" } as NodeJS.ProcessEnv).stallMs).toBe(
      DEFAULT_UPLINK_STALL_MS
    );
  });

  it("recognises the demuxer resync line ffmpeg actually prints", () => {
    expect(
      isTimestampDiscontinuityLine(
        "[aist#0:1/aac @ 0x73c1ef0bad40] timestamp discontinuity (stream id=0): 10960504, new offset= -90974028060"
      )
    ).toBe(true);
    expect(isTimestampDiscontinuityLine("[hls @ 0x55] skipping 1 segment ahead, expired from playlists")).toBe(false);
    expect(isTimestampDiscontinuityLine("frame= 1234 fps=60")).toBe(false);
  });

  it("restarts an uplink whose input timeline came apart", () => {
    // Measured in production: a healthy uplink reports none of these, the torn state ran at 450-530
    // a minute while encoding at full CPU -- so out_time kept advancing and the stall detector was
    // blind to it.
    let state = createUplinkDiscontinuityState(0);
    for (let index = 0; index < 500; index += 1) {
      state = observeDiscontinuityLine(state, "timestamp discontinuity (stream id=0): 1", 1_000 + index * 100);
    }

    expect(state.count).toBeGreaterThanOrEqual(DEFAULT_DISCONTINUITY_LIMIT);
    expect(isDiscontinuityStorm(state, 120_000, 0, OPTIONS)).toBe(true);
  });

  it("ignores the handful a legitimate seam produces", () => {
    let state = createUplinkDiscontinuityState(0);
    for (let index = 0; index < 10; index += 1) {
      state = observeDiscontinuityLine(state, "timestamp discontinuity (stream id=0): 1", 1_000 + index * 10);
    }

    expect(isDiscontinuityStorm(state, 120_000, 0, OPTIONS)).toBe(false);
  });

  it("forgets a burst once its window has passed", () => {
    let state = createUplinkDiscontinuityState(0);
    for (let index = 0; index < 500; index += 1) {
      state = observeDiscontinuityLine(state, "timestamp discontinuity", 1_000 + index * 10);
    }
    expect(isDiscontinuityStorm(state, 120_000, 0, OPTIONS)).toBe(true);

    // A single later line opens a fresh window rather than inheriting the old count.
    state = observeDiscontinuityLine(state, "timestamp discontinuity", 200_000);
    expect(state.count).toBe(1);
    expect(isDiscontinuityStorm(state, 200_000, 0, OPTIONS)).toBe(false);
  });

  it("stays silent during the grace period", () => {
    let state = createUplinkDiscontinuityState(0);
    for (let index = 0; index < 500; index += 1) {
      state = observeDiscontinuityLine(state, "timestamp discontinuity", index * 10);
    }

    expect(isDiscontinuityStorm(state, OPTIONS.graceMs - 1, 0, OPTIONS)).toBe(false);
  });
});

describe("managed uplink thresholds (M56 part 2)", () => {
  it("resolves managed values first, seconds in the GUI, milliseconds here", () => {
    const options = getUplinkStallOptions({ UPLINK_STALL_TIMEOUT_MS: "30000" } as NodeJS.ProcessEnv, {
      uplinkStallTimeoutSeconds: "90",
      uplinkNoProgressRestartSeconds: "120"
    });

    expect(options.stallMs).toBe(90_000);
    expect(options.graceMs).toBe(60_000);
    expect(options.noProgressRestartMs).toBe(120_000);
  });
});

describe("how long the uplink group has been standing", () => {
  it("reports the youngest start, so one crash-looping profile cannot borrow another's uptime", () => {
    // With two output profiles, taking the oldest let a profile that restarts every few seconds
    // read as "up for 45 minutes" -- the number came from the undisturbed sibling process.
    const stable = "2026-08-27T11:15:00.000Z";
    const flapping = "2026-08-27T12:00:00.000Z";
    expect(pickUplinkGroupStartedAt([stable, flapping])).toBe(flapping);
    expect(pickUplinkGroupStartedAt([flapping, stable])).toBe(flapping);
  });

  it("says nothing when nothing is running", () => {
    expect(pickUplinkGroupStartedAt([])).toBe("");
    expect(pickUplinkGroupStartedAt(["", ""])).toBe("");
  });
});
