/**
 * Detection for a playout that keeps producing video after its source has run out.
 *
 * Observed in production: a VOD finished, ffmpeg did not exit, and the `fps=60` filter kept
 * manufacturing frames by duplicating the last one — over ten million of them across two and a half
 * days. Video packets therefore kept flowing and every liveness check stayed green, while the
 * channel showed a frozen picture that never reached Twitch at all: audio cannot be duplicated, so
 * the program feed carried a silent audio stream, the uplink could not determine its parameters,
 * and it wrote nothing.
 *
 * Audio is the honest signal. A source that is still delivering produces audio packets; a stalled or
 * exhausted one produces none, however much video the filter graph invents on top of it.
 */

export type FeedAudioSample = {
  /** Audio packets counted in the segment that was probed. */
  audioPackets: number;
  /** Video packets in the same segment, to tell "source ended" from "nothing is running at all". */
  videoPackets: number;
  atMs: number;
};

export type FeedAudioState = {
  /** When audio was last seen, or when tracking began if it never has. */
  lastAudioAtMs: number;
  /** False until a segment with audio has been observed; a feed that starts silent is not judged. */
  seenAudio: boolean;
};

export type FeedAudioOptions = {
  /** How long the feed may carry video without audio before the playout counts as stalled. */
  silenceMs: number;
  /** Quiet period after the process starts, covering the first segments being written. */
  graceMs: number;
};

export const DEFAULT_FEED_SILENCE_MS = 90_000;
export const DEFAULT_FEED_GRACE_MS = 60_000;

export function getFeedAudioOptions(env: NodeJS.ProcessEnv): FeedAudioOptions {
  return {
    silenceMs: readPositiveMs(env.PLAYOUT_FEED_SILENCE_MS, DEFAULT_FEED_SILENCE_MS),
    graceMs: readPositiveMs(env.PLAYOUT_FEED_GRACE_MS, DEFAULT_FEED_GRACE_MS)
  };
}

export function createFeedAudioState(nowMs: number): FeedAudioState {
  return { lastAudioAtMs: nowMs, seenAudio: false };
}

export function observeFeedAudio(state: FeedAudioState, sample: FeedAudioSample): FeedAudioState {
  if (sample.audioPackets > 0) {
    return { lastAudioAtMs: sample.atMs, seenAudio: true };
  }
  return state;
}

/**
 * True when the feed has carried video without audio for longer than any real gap.
 *
 * Requires video to be flowing: a feed with neither is a playout that is not producing at all, which
 * the existing process supervision already covers, and restarting on it would fight that.
 *
 * Requires audio to have been seen once. A source genuinely without an audio track — a silent clip,
 * a slate — must not be restarted every 90 seconds forever.
 */
export function isFeedAudioStalled(
  state: FeedAudioState,
  sample: FeedAudioSample,
  startedAtMs: number,
  options: FeedAudioOptions
): boolean {
  if (sample.atMs - startedAtMs < options.graceMs) {
    return false;
  }
  if (!state.seenAudio || sample.videoPackets <= 0 || sample.audioPackets > 0) {
    return false;
  }
  return sample.atMs - state.lastAudioAtMs >= options.silenceMs;
}

function readPositiveMs(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
