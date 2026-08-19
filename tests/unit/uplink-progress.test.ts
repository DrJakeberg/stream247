import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPLINK_GRACE_MS,
  canBlameUplinkForStall,
  DEFAULT_UPLINK_STALL_MS,
  createUplinkProgressState,
  getUplinkStallOptions,
  hasNeverProgressed,
  isUplinkStalled,
  observeUplinkProgress
} from "../../apps/worker/src/uplink-progress.js";

// The outage this guards against: the uplink ffmpeg stayed alive at 0.02% CPU, encoded nothing, and
// pulled audio and video apart while every health surface reported "ok". Process liveness could not
// tell "running" from "working"; out_time can.

const OPTIONS = { stallMs: 45_000, graceMs: 60_000 };

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

  it("never kills a process that has not reported progress yet", () => {
    // A slow RTMP connect is indistinguishable from a stall here, and a false positive on a live
    // uplink means a restart loop on air.
    const state = createUplinkProgressState(0);

    expect(isUplinkStalled(state, 10 * 60_000, 0, OPTIONS)).toBe(false);
    expect(hasNeverProgressed(state, 10 * 60_000, 0, OPTIONS)).toBe(true);
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
      graceMs: DEFAULT_UPLINK_GRACE_MS
    });
    expect(
      getUplinkStallOptions({ UPLINK_STALL_TIMEOUT_MS: "20000", UPLINK_STALL_GRACE_MS: "5000" } as NodeJS.ProcessEnv)
    ).toEqual({ stallMs: 20_000, graceMs: 5_000 });
    expect(getUplinkStallOptions({ UPLINK_STALL_TIMEOUT_MS: "0" } as NodeJS.ProcessEnv).stallMs).toBe(
      DEFAULT_UPLINK_STALL_MS
    );
  });
});
