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
    expect(parseDiscontinuityOffsetLine(VIDEO)).toEqual({ stream: "video", offsetUs: 11098217998, deltaUs: -95443717690 });
    expect(parseDiscontinuityOffsetLine(AUDIO)).toEqual({ stream: "audio", offsetUs: -84345499692, deltaUs: 95443717693 });
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
    // These two sample lines are a counter wraparound, not a boundary — both deltas are the 33-bit
    // period. The "skew" they produce is that period, which says nothing about how far audio ran ahead.
    expect(result.seam?.wraparound).toBe(true);
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

  it("measures the seam when ffmpeg puts both streams in one stderr chunk", () => {
    // Verbatim from the DUT at 2026-09-06 03:44:11, the first boundary under v2.0.0-rc.1: one chunk,
    // two lines. Matching the chunk as a single string saw only the video line, so no pair closed and
    // the seam went unmeasured — the numbers in this test had to be parsed out of the raw log by hand.
    const chunk =
      "[vist#0:0/h264 @ 0x7a597f7b3e00] timestamp discontinuity (stream id=0): 69543734355, new offset= -69543734355\n" +
      "[aist#0:1/aac @ 0x7a598098ad00] timestamp discontinuity (stream id=0): -6264642, new offset= -69537469713";

    const { seam } = observeSeamOffsetLine(createUplinkSeamState(), chunk, 1_000);

    expect(seam).not.toBeNull();
    expect(seam?.videoOffsetUs).toBe(-69543734355);
    expect(seam?.audioOffsetUs).toBe(-69537469713);
    expect(seam?.skewSeconds).toBeCloseTo(6.264642, 6);
    expect(seam?.wraparound).toBe(false);
  });

  it("labels the counter wraparound instead of reporting it as an audio lead", () => {
    // 2026-09-06 06:44 on the DUT: video jumped one 33-bit period back, audio the same period forward,
    // and the pair's |audio − video| came out as that very period. Reported as a skew it would argue
    // for a dts_delta_threshold of a day; the event itself was three lines and no restart.
    let state = createUplinkSeamState();
    state = observeSeamOffsetLine(
      state,
      "[vist#0:0/h264 @ 0x1] timestamp discontinuity (stream id=0): -95443717690, new offset= 25906247976",
      1_000
    ).state;
    const { seam } = observeSeamOffsetLine(
      state,
      "[aist#0:1/aac @ 0x2] timestamp discontinuity (stream id=0): 95443717690, new offset= -69537469705",
      1_100
    );

    expect(seam?.wraparound).toBe(true);
    expect(seam?.skewSeconds).toBeCloseTo(95443.718, 3);
  });
});

describe("stderr arriving in arbitrary chunks", () => {
  it("measures a seam whose audio line was cut across two chunks", () => {
    // 2026-09-07 23:03 on the DUT. The audio half arrived without its "[aist#0:1/aac @ 0x...]" head
    // because the chunk boundary fell inside the line, so the pattern did not match and the seam went
    // unmeasured — the seam that finally tested the threshold: 15.061s, three lines, no restart. The
    // caller reassembles whole lines before measuring; this is that reassembly, with the real split.
    const first =
      "[vist#0:0/h264 @ 0x1] timestamp discontinuity (stream id=0): 69334751022, new offset= -65750201023\n" +
      "[aist#0:1/aac @ 0x2] ";
    const second = "timestamp discontinuity (stream id=0): -15061275, new offset= -65735139748\n";

    let carry = "";
    let state = createUplinkSeamState();
    let seam: ReturnType<typeof observeSeamOffsetLine>["seam"] = null;
    for (const chunk of [first, second]) {
      const carried = `${carry}${chunk}`;
      const completed = carried.split("\n");
      carry = completed.pop() ?? "";
      const result = observeSeamOffsetLine(state, completed.join("\n"), 1_000);
      state = result.state;
      seam = result.seam ?? seam;
    }

    expect(seam).not.toBeNull();
    expect(seam?.videoOffsetUs).toBe(-65750201023);
    expect(seam?.audioOffsetUs).toBe(-65735139748);
    expect(seam?.skewSeconds).toBeCloseTo(15.061, 3);
    expect(seam?.wraparound).toBe(false);
  });
});
