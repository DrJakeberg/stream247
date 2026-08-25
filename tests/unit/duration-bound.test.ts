import { describe, expect, it } from "vitest";
import {
  DEFAULT_DURATION_BOUND_MARGIN_SECONDS,
  getDurationBoundOptions,
  shouldEndAssetAtDurationBound
} from "../../apps/worker/src/duration-bound.js";

// The fault this ends before the watchdogs have to: a remotely streamed VOD reaches its end
// without ffmpeg receiving EOF. The process stays alive reading nothing, the fps filter duplicates
// the last frame, audio goes silent, the uplink encoder stalls and its watchdog restarts it after
// ~45s (one viewer-visible discontinuity), and only at 91s of silence does the feed-audio watchdog
// rotate the asset. With the duration known, the asset is ended deliberately at duration plus a
// margin instead — a planned transition, not a rescue.

const MARGIN = DEFAULT_DURATION_BOUND_MARGIN_SECONDS;

function input(overrides: Partial<Parameters<typeof shouldEndAssetAtDurationBound>[0]> = {}) {
  // A 30-minute VOD that started at t=0, judged just past duration + margin.
  return {
    targetKind: "asset" as const,
    durationSeconds: 1_800,
    processStartedAtMs: 1,
    nowMs: 1 + (1_800 + MARGIN) * 1000,
    marginSeconds: MARGIN,
    ...overrides
  };
}

describe("asset duration bound", () => {
  it("ends the asset once elapsed playback reaches duration plus margin", () => {
    expect(shouldEndAssetAtDurationBound(input())).toBe(true);
  });

  it("never fires while elapsed is below duration plus margin", () => {
    // One millisecond short of the bound: the margin belongs to the asset, not to us.
    expect(shouldEndAssetAtDurationBound(input({ nowMs: (1_800 + MARGIN) * 1000 }))).toBe(false);
    // Mid-playback, the common case on every cycle.
    expect(shouldEndAssetAtDurationBound(input({ nowMs: 1 + 900_000 }))).toBe(false);
  });

  it("applies to inserts too, which are file assets with the same fault", () => {
    expect(shouldEndAssetAtDurationBound(input({ targetKind: "insert" }))).toBe(true);
  });

  it("never fires when the duration is unknown — the rollback path", () => {
    // Missing metadata is stored as zero; the feed-audio watchdog stays the net for these.
    expect(shouldEndAssetAtDurationBound(input({ durationSeconds: 0 }))).toBe(false);
    expect(shouldEndAssetAtDurationBound(input({ durationSeconds: -1 }))).toBe(false);
    expect(shouldEndAssetAtDurationBound(input({ durationSeconds: Number.NaN }))).toBe(false);
    expect(shouldEndAssetAtDurationBound(input({ durationSeconds: Number.POSITIVE_INFINITY }))).toBe(false);
  });

  it("never fires for live-bridge input, however long it runs", () => {
    // A live input is open-ended by nature; its metadata duration, if any, means nothing.
    expect(shouldEndAssetAtDurationBound(input({ targetKind: "live", nowMs: 1 + 24 * 3600_000 }))).toBe(false);
  });

  it("never fires for standby, reconnect, or no target at all", () => {
    expect(shouldEndAssetAtDurationBound(input({ targetKind: "standby", nowMs: 1 + 24 * 3600_000 }))).toBe(false);
    expect(shouldEndAssetAtDurationBound(input({ targetKind: "reconnect", nowMs: 1 + 24 * 3600_000 }))).toBe(false);
    expect(shouldEndAssetAtDurationBound(input({ targetKind: "", nowMs: 1 + 24 * 3600_000 }))).toBe(false);
  });

  it("never fires without a known process start time", () => {
    // Zero is the module's "no process running" value; there is no elapsed playback to judge.
    expect(shouldEndAssetAtDurationBound(input({ processStartedAtMs: 0 }))).toBe(false);
  });

  it("never fires with a margin that would allow cutting at the exact duration", () => {
    // A margin of zero or less defeats the safety the margin provides, so it is invalid.
    expect(shouldEndAssetAtDurationBound(input({ marginSeconds: 0, nowMs: 1 + 3_600_000 }))).toBe(false);
    expect(shouldEndAssetAtDurationBound(input({ marginSeconds: -5, nowMs: 1 + 3_600_000 }))).toBe(false);
  });

  it("reads the margin from the environment with a usable default", () => {
    expect(getDurationBoundOptions({} as NodeJS.ProcessEnv)).toEqual({
      marginSeconds: DEFAULT_DURATION_BOUND_MARGIN_SECONDS
    });
    expect(getDurationBoundOptions({ PLAYOUT_DURATION_BOUND_MARGIN_SECONDS: "30" } as NodeJS.ProcessEnv).marginSeconds).toBe(30);
    expect(getDurationBoundOptions({ PLAYOUT_DURATION_BOUND_MARGIN_SECONDS: "0" } as NodeJS.ProcessEnv).marginSeconds).toBe(
      DEFAULT_DURATION_BOUND_MARGIN_SECONDS
    );
    expect(getDurationBoundOptions({ PLAYOUT_DURATION_BOUND_MARGIN_SECONDS: "-15" } as NodeJS.ProcessEnv).marginSeconds).toBe(
      DEFAULT_DURATION_BOUND_MARGIN_SECONDS
    );
    expect(getDurationBoundOptions({ PLAYOUT_DURATION_BOUND_MARGIN_SECONDS: "nope" } as NodeJS.ProcessEnv).marginSeconds).toBe(
      DEFAULT_DURATION_BOUND_MARGIN_SECONDS
    );
  });
});
