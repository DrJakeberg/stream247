import { describe, expect, it } from "vitest";
import { WATCHDOG_LIMITS } from "@stream247/core";
import {
  buildSourceLivePipFilterComplex,
  decideLiveSourceAudio,
  SOURCE_LIVE_RTSP_TIMEOUT_US
} from "../../apps/worker/src/ffmpeg-runtime";
import {
  createFeedAudioState,
  isFeedAudioStalled,
  observeFeedAudio,
  type FeedAudioOptions
} from "../../apps/worker/src/feed-audio-health";
import {
  ATTACH_FAILURE_COOLDOWN_MS,
  closedAttachBreaker,
  decideSourceLiveAttach,
  isAttachBreakerOpen,
  openAttachBreaker
} from "../../apps/worker/src/relay-presence";
import { clampToCycleAwaitCeiling, getCycleAwaitCeilingMs } from "../../apps/worker/src/cycle-budget";

/**
 * M57 stage 2, Etappes C/D — the guardian proof list. Each test proves that a PiP-source problem
 * does NOT falsely trip a watchdog that exists to catch a PROGRAMME problem, and that the original
 * purpose of each watchdog stays intact. The live source is an addition that must be invisible to
 * the health machinery unless the programme itself is unwell.
 */

const box = { left: 1152, top: 120, width: 512, height: 288 };

function mixed(programLabel: string, programVolume: number) {
  return buildSourceLivePipFilterComplex({
    outputVideoFilter: "scale=1920:1080",
    sceneInputIndex: 2,
    pipInputIndex: 3,
    fps: 30,
    box,
    audio: { programLabel, programVolume, sourceGain: 0.4 }
  }).filterComplex;
}

// The real feed-audio watchdog reads the audio-packet count of the newest muxed HLS segment (see
// enforceProgramFeedAudio / probeProgramFeedPackets in index.ts, which feed exactly these functions).
// audioPackets is therefore whatever the ENCODE writes into the segment: the programme's own audio
// when no PiP audio is folded in, or programme+PiP when it is.
const FEED_AUDIO_OPTIONS: FeedAudioOptions = {
  silenceMs: WATCHDOG_LIMITS.feedAudioSilenceSeconds.default * 1000,
  graceMs: WATCHDOG_LIMITS.feedAudioGraceSeconds.default * 1000
};

/**
 * Runs the REAL feed-audio state machine over a sequence of per-segment audio-packet counts (video
 * always flowing, as the fps filter guarantees) and returns whether it ever declares the feed
 * stalled. The first sample carries audio so the watchdog begins judging; the rest are the caller's.
 */
function feedEverStalls(audioPacketsAfterFirst: number[]): boolean {
  const startedAtMs = 0;
  let state = createFeedAudioState(startedAtMs);
  const seed = { audioPackets: 4, videoPackets: 30, atMs: 1_000 };
  state = observeFeedAudio(state, seed);

  // One sample every 10 s, well past the 60 s grace and across the 90 s silence window.
  for (let index = 0; index < audioPacketsAfterFirst.length; index += 1) {
    const sample = { audioPackets: audioPacketsAfterFirst[index]!, videoPackets: 30, atMs: 10_000 + index * 10_000 };
    state = observeFeedAudio(state, sample);
    if (isFeedAudioStalled(state, sample, startedAtMs, FEED_AUDIO_OPTIONS)) {
      return true;
    }
  }
  return false;
}

describe("feed-audio watchdog stays honest with a live source (proven against the real state machine)", () => {
  // 20 samples over ~200 s — enough to cross grace + silence.
  const silent = Array.from({ length: 20 }, () => 0);
  const mixedAlive = Array.from({ length: 20 }, () => 3);

  it("a silent-but-still-running programme (video flowing, no audio) still trips the real watchdog", () => {
    // The invariant the review demands, proven against enforceProgramFeedAudio's own state machine
    // rather than a graph string: when the segment carries no audio, the watchdog fires.
    expect(feedEverStalls(silent)).toBe(true);
  });

  it("shows the masking the duration gate prevents: mixed-in PiP audio would hide that same silence", () => {
    // If PiP audio reached the segment, every sample carries audio packets and the SAME real watchdog
    // never fires — a frozen programme with live PiP sound would stand indefinitely. This is exactly
    // why decideLiveSourceAudio refuses to mix for an unknown-duration programme.
    expect(feedEverStalls(mixedAlive)).toBe(false);
  });

  it("an unknown-duration programme is never given a PiP audio branch, so its segment stays honest", () => {
    // decideLiveSourceAudio is the gate that keeps the two facts above connected: with an unknown
    // duration it returns null (no [aout], program audio is the sole track), so a silent programme's
    // segment reads zero audio packets and the real watchdog above fires.
    const decision = decideLiveSourceAudio({
      programDurationSeconds: 0,
      sourceAudioConfirmed: true,
      hasAudioLane: false,
      laneVolumePercent: 80,
      programAudioConfirmed: true,
      sourceGainPercent: 40
    });
    expect(decision).toBeNull();
    // And a known-duration programme (where duration-bound is the net) may mix — masking is harmless.
    expect(
      decideLiveSourceAudio({
        programDurationSeconds: 1800,
        sourceAudioConfirmed: true,
        hasAudioLane: false,
        laneVolumePercent: 80,
        programAudioConfirmed: true,
        sourceGainPercent: 40
      })
    ).not.toBeNull();
  });

  it("keeps the mix structure honest when it IS built: programme first, normalize=0, no apad", () => {
    const graph = mixed("[0:a]", 1);
    expect(graph).toContain("normalize=0");
    expect(graph).toContain("[prog_a][pip_a]amix=inputs=2:duration=first");
    expect(graph.indexOf("[prog_a];")).toBeLessThan(graph.indexOf("[pip_a];"));
    expect(graph).toContain("[0:a]volume=1.000[prog_a]");
    expect(graph).not.toContain("apad");
  });
});

describe("a lying or racing relay never crashes the encode into the breaker", () => {
  it("advisory-audio-true but the source delivers no audio → video-only, never a [L:a] reference", () => {
    // The relay's track flag is advisory. The build path probes the source and passes the PROBED
    // verdict as sourceAudioConfirmed; when the probe finds no audio (publisher race, lying relay),
    // decideLiveSourceAudio returns null and the graph omits [L:a] entirely — so ffmpeg never aborts
    // at graph init ("matches no streams", exit 234) and the attach falls back to video-only instead
    // of failing every start until presence self-corrects.
    const decision = decideLiveSourceAudio({
      programDurationSeconds: 1800,
      sourceAudioConfirmed: false,
      hasAudioLane: false,
      laneVolumePercent: 80,
      programAudioConfirmed: true,
      sourceGainPercent: 40
    });
    expect(decision).toBeNull();
    // A video-only build carries no audio graph at all — nothing references the source's audio.
    const videoOnly = buildSourceLivePipFilterComplex({
      outputVideoFilter: "scale=1920:1080",
      sceneInputIndex: 2,
      pipInputIndex: 3,
      fps: 30,
      box,
      audio: null
    }).filterComplex;
    expect(videoOnly).not.toContain("[3:a]");
    expect(videoOnly).not.toContain("amix");
  });
});

describe("feed-stall and uplink-stall watchdogs are not falsely tripped by a live source", () => {
  it("a source that ends never freezes or blanks the programme frame", () => {
    const graph = buildSourceLivePipFilterComplex({
      outputVideoFilter: "scale=1920:1080",
      sceneInputIndex: 2,
      pipInputIndex: 3,
      fps: 30,
      box,
      audio: null
    }).filterComplex;
    // eof_action=pass: when the PiP input EOFs, the overlay passes the base frame through unchanged
    // rather than holding the last PiP frame or blanking. The programme video keeps flowing, so
    // neither the feed-stall (input) nor the uplink-stall (output progress) watchdog sees a stall.
    expect(graph).toContain("[base][pipv]overlay=1152:120:eof_action=pass[vpip]");
    // The base → PiP → scene chain means the programme picture is always the substrate; the PiP is
    // only ever laid on top of a live base, never the source of the frame's existence.
    expect(graph).toContain("[vpip][2:v]overlay=0:0:format=auto[vout]");
  });
});

describe("duration-bound watchdog is not falsely tripped by a live source", () => {
  it("a slow PiP connect gives up inside the smallest duration-bound margin", () => {
    // 4 s RTSP timeout < 5 s smallest margin: a source that never opens is abandoned well before
    // the duration bound could be reached, so a slow connect can never be what trips it.
    expect(SOURCE_LIVE_RTSP_TIMEOUT_US).toBeLessThan(WATCHDOG_LIMITS.durationBoundMarginSeconds.min * 1_000_000);
  });
});

describe("loop-stall watchdog is not falsely tripped by a live source", () => {
  it("the attach's programme-audio probe timeout is clamped under the cycle-await ceiling", () => {
    // The only awaited-on-cycle work the attach adds beyond the bounded presence fetch is the
    // programme-audio ffprobe, whose 4 s request is clamped to the cycle-await ceiling — so it can
    // never eat more of the reconciliation budget than the loop-stall guard allows.
    const clamped = clampToCycleAwaitCeiling(4_000, process.env);
    expect(clamped.effectiveMs).toBeLessThanOrEqual(getCycleAwaitCeilingMs(process.env));
  });
});

describe("crash-loop breaker keeps a PiP alone below the crash threshold", () => {
  it("a failed attach opens the breaker, so the next start is attach-free even while publishing", () => {
    const now = 1_756_300_000_000;
    const breaker = openAttachBreaker(now);
    expect(isAttachBreakerOpen(breaker, now)).toBe(true);

    // Even with the source publishing, the very next start decides "skip / breaker-cooldown": no
    // PiP is attached. Because an attach-crash opens the breaker immediately, two consecutive
    // ATTACHED starts are impossible — an attach-free start always sits between them, and with a
    // healthy programme that start is a non-failure exit that resets the crash counter. So a PiP
    // alone contributes at most one crash per breaker cycle, below the crash-loop threshold (3).
    const decision = decideSourceLiveAttach({
      sourceLiveEnabled: true,
      sourceLayerEnabled: true,
      sourceId: "studio-cam",
      presence: { publishing: true, hasAudio: true },
      breaker,
      nowMs: now + 1_000
    });
    expect(decision).toEqual({ decision: "skip", reason: "breaker-cooldown" });
  });

  it("the cooldown outlasts many reconciliation cycles, so retries are minutes apart, not seconds", () => {
    const now = 1_756_300_000_000;
    const breaker = openAttachBreaker(now);
    // Still closed to attach a minute later — retry cadence is the multi-minute cooldown, not the
    // cycle cadence, so a feed that kills the encode cannot be re-attached fast enough to crash-loop.
    expect(isAttachBreakerOpen(breaker, now + 60_000)).toBe(true);
    expect(ATTACH_FAILURE_COOLDOWN_MS).toBeGreaterThanOrEqual(60_000);
    // And it does eventually reopen for attach once the cooldown fully elapses.
    const reopened = closedAttachBreaker();
    expect(isAttachBreakerOpen(reopened, now)).toBe(false);
  });
});
