import { describe, expect, it } from "vitest";
import {
  PROGRAM_FEED_SEGMENT_MIN_AGE_MS,
  selectStaleProgramFeedSegments,
  sumSegmentBytes
} from "../../apps/worker/src/program-feed-maintenance";

const NOW = new Date("2026-08-25T01:00:00.000Z").getTime();
const HOUR = 60 * 60 * 1000;

function segment(name: string, ageMs: number) {
  return { name, modifiedAtMs: NOW - ageMs };
}

/** A playlist naming two of its segments, the shape ffmpeg writes. */
const PLAYLIST = [
  "#EXTM3U",
  "#EXT-X-VERSION:6",
  "#EXT-X-TARGETDURATION:2",
  "#EXTINF:2.000000,",
  "segment-live-1.ts",
  "#EXTINF:2.000000,",
  "segment-live-2.ts"
].join("\n");

describe("sweeping the program feed", () => {
  it("removes what no playlist mentions and nothing else", () => {
    const stale = selectStaleProgramFeedSegments({
      segments: [
        segment("segment-live-1.ts", 4 * HOUR),
        segment("segment-live-2.ts", 4 * HOUR),
        segment("segment-old-run-1.ts", 4 * HOUR),
        segment("segment-old-run-2.ts", 30 * 24 * HOUR)
      ],
      playlist: PLAYLIST,
      nowMs: NOW
    });

    expect(stale).toEqual(["segment-old-run-1.ts", "segment-old-run-2.ts"]);
  });

  it("leaves a segment alone until it is older than the margin, referenced or not", () => {
    // The case that makes this safe on air: a segment written a moment ago may be named by a
    // playlist that has not been flushed yet, and the uplink can be mid-download of one that just
    // rolled out of the window.
    const stale = selectStaleProgramFeedSegments({
      segments: [segment("segment-just-written.ts", 5_000), segment("segment-a-while-ago.ts", 2 * HOUR)],
      playlist: PLAYLIST,
      nowMs: NOW
    });

    expect(stale).toEqual(["segment-a-while-ago.ts"]);
  });

  it("keeps a segment the playlist still names however old it is", () => {
    // A channel that has been sitting on one long asset can have a live segment older than the
    // margin. Age alone must never be enough.
    const stale = selectStaleProgramFeedSegments({
      segments: [segment("segment-live-1.ts", 40 * 24 * HOUR)],
      playlist: PLAYLIST,
      nowMs: NOW
    });

    expect(stale).toEqual([]);
  });

  it("deletes nothing when the playlist could not be read", () => {
    // An empty playlist means "no reference information", not "nothing is referenced". Treating it
    // as the latter would empty the directory the channel is reading from.
    const segments = [segment("segment-live-1.ts", 4 * HOUR), segment("segment-old.ts", 4 * HOUR)];

    expect(selectStaleProgramFeedSegments({ segments, playlist: "", nowMs: NOW })).toEqual([]);
    expect(selectStaleProgramFeedSegments({ segments, playlist: "   \n", nowMs: NOW })).toEqual([]);
  });

  it("has a margin measured in minutes, not seconds", () => {
    expect(PROGRAM_FEED_SEGMENT_MIN_AGE_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it("reports what a sweep would reclaim", () => {
    const bytes = sumSegmentBytes(
      [
        { name: "segment-old-run-1.ts", bytes: 430_000 },
        { name: "segment-old-run-2.ts", bytes: 430_000 },
        { name: "segment-live-1.ts", bytes: 430_000 }
      ],
      ["segment-old-run-1.ts", "segment-old-run-2.ts"]
    );

    expect(bytes).toBe(860_000);
  });
});
