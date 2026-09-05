import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROGRAMME_AUDIO_PAD_SLACK_SECONDS,
  resolveProgrammeAudioPadSeconds,
  usesShortestFlag
} from "../../apps/worker/src/ffmpeg-runtime";
import {
  createFeedAudioState,
  isFeedAudioStalled,
  observeFeedAudio,
  type FeedAudioState
} from "../../apps/worker/src/feed-audio-health";

/**
 * Silence after the input runs dry, so the feed never carries picture without sound — and only for
 * as long as that is needed.
 *
 * THE FAULT. Measured on the live channel at three consecutive boundaries: the feed carries video
 * WITHOUT audio for the last 20-30 seconds of every asset. The input reaches EOF and `-map 0:a?`
 * stops, but the picture does not — overlay ends with its LONGEST input and the scene pipe never
 * ends — and the duration bound only cuts at `duration + margin`. The uplink's reader keeps its
 * offset per FILE and next_dts per STREAM, so audio's clock freezes across that stretch and then
 * oscillates against video when the next asset restores sound: 244, 279 and 212 discontinuity
 * lines, each one restarting the uplink. The proof is arithmetic — the two offset clusters sit
 * exactly the silent stretch apart and the lower one is exactly the asset's recorded duration
 * (07:44: cluster 15040.05s against a recorded 15040s; 07:56: 739.04s against 739s).
 *
 * WHY THE PAD IS BOUNDED, which is the whole of the second half of this file. An unbounded `apad`
 * fixes the storm and disables the feed-audio watchdog for ever, because that watchdog keys on
 * audio PACKET PRESENCE and apad manufactures real AAC frames indefinitely. Adversarial review
 * measured it on the project's own compiled watchdog: without padding the tail segments carry
 * audioPackets=0 and it fires at 96s; with unbounded padding it never fires again. That matters
 * most exactly where it is the only net — `durationSeconds` is written only by the yt-dlp path, so
 * every local-library file and direct-media URL is permanently unknown-duration, and the global
 * fallback asset is by construction a local-library file. An unbounded pad would leave the fallback
 * able to sit on a frozen frame with digital silence with nothing in the system able to end it.
 *
 * So the pad lasts the margin plus slack and then stops, and the silence signal comes back.
 */
const PLAIN_ASSET = {
  overlayMode: "scene" as const,
  hasAudioLane: false,
  pipAudioMapped: false,
  attachLive: false,
  durationBoundMarginSeconds: 15
};

describe("programme audio padding", () => {
  it("pads the plain asset path, for the margin plus slack", () => {
    expect(resolveProgrammeAudioPadSeconds(PLAIN_ASSET)).toBe(15 + PROGRAMME_AUDIO_PAD_SLACK_SECONDS);
  });

  it("follows the configured margin rather than a constant", () => {
    // The margin is operator-configurable from 5 to 120 seconds. A hard-coded pad would under-cover
    // a raised margin and leave the storm exactly where it was.
    expect(resolveProgrammeAudioPadSeconds({ ...PLAIN_ASSET, durationBoundMarginSeconds: 120 })).toBe(
      120 + PROGRAMME_AUDIO_PAD_SLACK_SECONDS
    );
    expect(resolveProgrammeAudioPadSeconds({ ...PLAIN_ASSET, durationBoundMarginSeconds: 5 })).toBe(
      5 + PROGRAMME_AUDIO_PAD_SLACK_SECONDS
    );
  });

  it("covers every overrun actually observed on air", () => {
    // Measured overruns at the three boundaries, against the default margin of 15s.
    for (const overrun of [30.4, 22.75, 18.98]) {
      expect({ overrun, covered: resolveProgrammeAudioPadSeconds(PLAIN_ASSET) > overrun }).toEqual({
        overrun,
        covered: true
      });
    }
  });

  it("leaves text and none modes alone, where the picture ends with the file", () => {
    expect(resolveProgrammeAudioPadSeconds({ ...PLAIN_ASSET, overlayMode: "text" })).toBe(0);
    expect(resolveProgrammeAudioPadSeconds({ ...PLAIN_ASSET, overlayMode: "none" })).toBe(0);
  });

  it("leaves a looping lane and a picture-in-picture mix alone, because neither starves", () => {
    expect(resolveProgrammeAudioPadSeconds({ ...PLAIN_ASSET, hasAudioLane: true })).toBe(0);
    expect(resolveProgrammeAudioPadSeconds({ ...PLAIN_ASSET, pipAudioMapped: true })).toBe(0);
  });

  it("never pads where -shortest is set, in any combination", () => {
    for (const hasAudioLane of [true, false]) {
      for (const pipAudioMapped of [true, false]) {
        for (const attachLive of [true, false]) {
          const shortest = usesShortestFlag({ hasAudioLane, pipAudioMapped, attachLive });
          const padded = resolveProgrammeAudioPadSeconds({ ...PLAIN_ASSET, hasAudioLane, pipAudioMapped, attachLive }) > 0;
          expect({ hasAudioLane, pipAudioMapped, attachLive, both: shortest && padded }).toEqual({
            hasAudioLane,
            pipAudioMapped,
            attachLive,
            both: false
          });
        }
      }
    }
  });

  it("refuses a margin that is not a usable number", () => {
    for (const margin of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveProgrammeAudioPadSeconds({ ...PLAIN_ASSET, durationBoundMarginSeconds: margin })).toBe(0);
    }
  });
});

describe("the feed-audio watchdog survives the padding", () => {
  /** Drives the real watchdog over a feed that pads for `padSeconds` and then falls silent. */
  function firesAfter(padSeconds: number, runSeconds: number): boolean {
    const options = { silenceMs: 90_000, graceMs: 20_000 };
    const startedAtMs = 0;
    let state: FeedAudioState = createFeedAudioState(startedAtMs);
    // Audio flows for the content, then for the pad, then stops. Video flows throughout, because
    // the scene overlay keeps inventing it — that is the whole shape of the fault.
    const contentSeconds = 30;
    for (let second = 2; second <= runSeconds; second += 2) {
      const audioPackets = second <= contentSeconds + padSeconds ? 86 : 0;
      const sample = { atMs: second * 1000, audioPackets, videoPackets: 60 };
      state = observeFeedAudio(state, sample);
      if (isFeedAudioStalled(state, sample, startedAtMs, options)) {
        return true;
      }
    }
    return false;
  }

  it("still fires once the bounded pad has run out", () => {
    // 45s of padding, then silence: the watchdog's 90s timer starts again and it fires.
    expect(firesAfter(45, 400)).toBe(true);
  });

  it("would never fire against an unbounded pad — the regression this bound exists to prevent", () => {
    // The mutation check. Adversarial review measured exactly this on the compiled watchdog: with
    // unbounded apad the tail segments carry audioPackets=86 for ever and it can never fire.
    expect(firesAfter(Number.POSITIVE_INFINITY, 4000)).toBe(false);
  });

  it("fires no later than the pad plus its own silence window", () => {
    // The cost of the fix, stated as a number: the net is delayed by the pad, not removed.
    expect(firesAfter(45, 30 + 45 + 90 - 4)).toBe(false);
    expect(firesAfter(45, 30 + 45 + 90 + 4)).toBe(true);
  });
});

describe("the padding is wired where the fault is", () => {
  const workerSource = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");

  it("asks the one function rather than repeating its conditions", () => {
    expect(workerSource).toContain("resolveProgrammeAudioPadSeconds({");
    expect(workerSource).toContain('command.push("-af", `apad=pad_dur=${String(programmeAudioPadSeconds)}`);');
  });

  it("adds no second -af anywhere in the playout command builders", () => {
    const pushes = workerSource.match(/command\.push\("-af"/g) ?? [];
    expect(pushes).toHaveLength(2);
  });

  it("never emits a bare apad, which would be the unbounded form", () => {
    expect(workerSource).not.toMatch(/"-af",\s*"apad"/);
  });
});
