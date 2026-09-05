import { describe, expect, it } from "vitest";
import {
  createUplinkSeamState,
  observeSeamOffsetLine,
  parseDiscontinuityOffsetLine
} from "../../apps/worker/src/uplink-progress";

/**
 * The seam metric, automated (M61). Across nine boundaries measured by hand on 2026-09-05 the one
 * number that separated a storm from a quiet boundary was the difference between the video and the
 * audio offset ffmpeg derived at the same seam: storms 11.84–13.45 s, quiet 1.07–6.69 s. Reading the
 * two lines by hand from docker logs does not scale; the supervisor pairs them as they arrive.
 */
const VIDEO = '[vist#0:0/h264 @ 0x74902564bcc0] timestamp discontinuity (stream id=0): -95443717690, new offset= 11098217998';
const AUDIO = '[aist#0:1/aac @ 0x749029434cc0] timestamp discontinuity (stream id=0): 95443717693, new offset= -84345499692';

describe("parseDiscontinuityOffsetLine", () => {
  it("reads the stream and the derived offset in microseconds", () => {
    expect(parseDiscontinuityOffsetLine(VIDEO)).toEqual({ stream: "video", offsetUs: 11098217998 });
    expect(parseDiscontinuityOffsetLine(AUDIO)).toEqual({ stream: "audio", offsetUs: -84345499692 });
  });

  it("ignores every other stderr line, including the corrupt-packet and out-of-order ones", () => {
    expect(parseDiscontinuityOffsetLine("[mpegts @ 0x1] Packet corrupt (stream = 0, dts = 378395090), dropping it.")).toBeNull();
    expect(parseDiscontinuityOffsetLine("[mpegts @ 0x1] DTS 8590062682 < 8590508182 out of order")).toBeNull();
    expect(parseDiscontinuityOffsetLine("")).toBeNull();
  });
});

describe("observeSeamOffsetLine", () => {
  it("reports the seam once both streams have derived an offset within the pairing window", () => {
    let state = createUplinkSeamState();
    let result = observeSeamOffsetLine(state, VIDEO, 1_000);
    state = result.state;
    expect(result.seam).toBeNull();
    result = observeSeamOffsetLine(state, AUDIO, 1_400);
    expect(result.seam).not.toBeNull();
    // |(-84345499692) - 11098217998| µs = 95443717690 µs = 95443.718 s: the 33-bit wrap, to the microsecond.
    expect(result.seam?.skewUs).toBe(95443717690);
    expect(result.seam?.skewSeconds).toBeCloseTo(95443.718, 3);
    expect(result.seam?.videoOffsetUs).toBe(11098217998);
    expect(result.seam?.audioOffsetUs).toBe(-84345499692);
  });

  it("does not pair a video line with an audio line from a different seam", () => {
    let state = createUplinkSeamState();
    state = observeSeamOffsetLine(state, VIDEO, 1_000).state;
    const late = observeSeamOffsetLine(state, AUDIO, 1_000 + 20_000);
    expect(late.seam).toBeNull();
    // The late line opens a new seam of its own.
    expect(late.state.audioOffsetUs).toBe(-84345499692);
    expect(late.state.videoOffsetUs).toBeUndefined();
  });

  it("reports one seam per pair and then starts over", () => {
    let state = createUplinkSeamState();
    state = observeSeamOffsetLine(state, VIDEO, 0).state;
    const paired = observeSeamOffsetLine(state, AUDIO, 100);
    expect(paired.seam).not.toBeNull();
    // A flood re-derives the video offset every packet; the second video line after a completed pair
    // must not report against the stale audio value.
    const again = observeSeamOffsetLine(paired.state, VIDEO.replace("11098217998", "11098218001"), 200);
    expect(again.seam).toBeNull();
  });
});
