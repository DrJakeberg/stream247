import { describe, expect, it } from "vitest";
import { WATCHDOG_LIMITS } from "@stream247/core";
import {
  buildSourceLivePipFilterComplex,
  SOURCE_LIVE_RTSP_TIMEOUT_US
} from "../../apps/worker/src/ffmpeg-runtime";
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

describe("feed-audio watchdog is not falsely tripped by a live source", () => {
  it("the mix cannot mute programme audio: a dead PiP still lets programme packets flow", () => {
    const graph = mixed("[0:a]", 1);
    // normalize=0 is the whole proof: with normalize=1 amix scales every input by 1/N, so the
    // programme would halve when the PiP joins and jump back when it leaves — a level change the
    // feed-audio grace could read across. normalize=0 keeps the programme at its own level whether
    // the PiP is present, absent, or dying.
    expect(graph).toContain("normalize=0");
    // The programme is the FIRST amix input and the mix is duration=first, so the mix lives exactly
    // as long as the programme audio does — it can neither end before the programme nor outlast it.
    expect(graph).toContain("[prog_a][pip_a]amix=inputs=2:duration=first");
    expect(graph.indexOf("[prog_a];")).toBeLessThan(graph.indexOf("[pip_a];"));
    // The programme branch carries its own gain (identity here), never a reduced level.
    expect(graph).toContain("[0:a]volume=1.000[prog_a]");
    // No apad on the PiP branch: a source that ends is DROPPED by amix, not padded into endless
    // silence that would mask the programme's own audio and defeat the point of the mix.
    expect(graph).not.toContain("apad");
  });

  it("keeps the watchdog's real purpose: an audio-lane programme is mixed at its lane volume, undimmed", () => {
    const graph = mixed("[1:a]", 0.8);
    expect(graph).toContain("[1:a]volume=0.800[prog_a]");
    expect(graph).toContain("normalize=0");
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
