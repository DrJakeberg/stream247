import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEED_GRACE_MS,
  DEFAULT_FEED_SILENCE_MS,
  createFeedAudioState,
  getFeedAudioOptions,
  isFeedAudioStalled,
  observeFeedAudio
} from "../../apps/worker/src/feed-audio-health.js";

// The outage this guards against: a VOD ran out, ffmpeg stayed alive, and the fps=60 filter kept
// manufacturing video by duplicating the last frame — ten million of them over two and a half days.
// Every liveness check stayed green because video packets kept flowing. Audio cannot be duplicated,
// so the feed carried a silent audio stream, the uplink could not determine its parameters and
// wrote nothing at all, and the channel was off the air the entire time.

const OPTIONS = { silenceMs: 90_000, graceMs: 60_000 };

function sample(audioPackets: number, videoPackets: number, atMs: number) {
  return { audioPackets, videoPackets, atMs };
}

describe("program feed audio health", () => {
  it("treats a feed carrying audio as healthy", () => {
    let state = createFeedAudioState(0);
    state = observeFeedAudio(state, sample(180, 120, 100_000));

    expect(isFeedAudioStalled(state, sample(175, 120, 102_000), 0, OPTIONS)).toBe(false);
  });

  it("reports a stall once audio has been gone longer than any real gap", () => {
    let state = createFeedAudioState(0);
    state = observeFeedAudio(state, sample(180, 120, 100_000));

    expect(isFeedAudioStalled(state, sample(0, 120, 100_000 + OPTIONS.silenceMs - 1), 0, OPTIONS)).toBe(false);
    expect(isFeedAudioStalled(state, sample(0, 120, 100_000 + OPTIONS.silenceMs), 0, OPTIONS)).toBe(true);
  });

  it("keeps reporting a stall while the duplicated video continues", () => {
    // The production case: 120 video packets per segment, forever, and never another audio packet.
    let state = createFeedAudioState(0);
    state = observeFeedAudio(state, sample(180, 120, 100_000));

    for (let at = 200_000; at <= 2 * 24 * 3600_000; at *= 2) {
      state = observeFeedAudio(state, sample(0, 120, at));
      expect(isFeedAudioStalled(state, sample(0, 120, at), 0, OPTIONS)).toBe(true);
    }
  });

  it("never judges a feed that has not carried audio yet", () => {
    // A silent clip or a slate has no audio track to lose. Restarting on it would loop forever.
    const state = createFeedAudioState(0);

    expect(isFeedAudioStalled(state, sample(0, 120, 10 * 3600_000), 0, OPTIONS)).toBe(false);
  });

  it("stays out of the way when nothing is being produced at all", () => {
    // No video either means the playout is not running, which process supervision already covers —
    // acting here would fight it.
    let state = createFeedAudioState(0);
    state = observeFeedAudio(state, sample(180, 120, 100_000));

    expect(isFeedAudioStalled(state, sample(0, 0, 500_000), 0, OPTIONS)).toBe(false);
  });

  it("stays silent while the first segments are still being written", () => {
    let state = createFeedAudioState(0);
    state = observeFeedAudio(state, sample(180, 120, 1_000));

    expect(isFeedAudioStalled(state, sample(0, 120, OPTIONS.graceMs - 1), 0, OPTIONS)).toBe(false);
  });

  it("clears once audio comes back", () => {
    let state = createFeedAudioState(0);
    state = observeFeedAudio(state, sample(180, 120, 100_000));
    state = observeFeedAudio(state, sample(0, 120, 150_000));
    expect(isFeedAudioStalled(state, sample(0, 120, 200_000), 0, OPTIONS)).toBe(true);

    state = observeFeedAudio(state, sample(180, 120, 210_000));
    expect(isFeedAudioStalled(state, sample(0, 120, 220_000), 0, OPTIONS)).toBe(false);
  });

  it("reads thresholds from the environment with usable defaults", () => {
    expect(getFeedAudioOptions({} as NodeJS.ProcessEnv)).toEqual({
      silenceMs: DEFAULT_FEED_SILENCE_MS,
      graceMs: DEFAULT_FEED_GRACE_MS
    });
    expect(getFeedAudioOptions({ PLAYOUT_FEED_SILENCE_MS: "30000" } as NodeJS.ProcessEnv).silenceMs).toBe(30_000);
    expect(getFeedAudioOptions({ PLAYOUT_FEED_SILENCE_MS: "0" } as NodeJS.ProcessEnv).silenceMs).toBe(
      DEFAULT_FEED_SILENCE_MS
    );
  });

  it("resolves managed thresholds first, seconds in the GUI, milliseconds here (M56 part 2)", () => {
    const options = getFeedAudioOptions({ PLAYOUT_FEED_SILENCE_MS: "30000" } as NodeJS.ProcessEnv, {
      feedAudioSilenceSeconds: "120",
      feedAudioGraceSeconds: "30"
    });

    expect(options.silenceMs).toBe(120_000);
    expect(options.graceMs).toBe(30_000);
  });
});
