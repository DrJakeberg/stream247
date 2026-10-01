import { describe, expect, it } from "vitest";
import { lastPtsSecondsFromProbeOutput, resolveFeedAvLead } from "../../apps/worker/src/feed-av-lead";

/**
 * M61: how far audio ran ahead of (or behind) video in the outgoing feed at the moment of a cut.
 * The uplink's seam skew is the same quantity seen from the reader's side; measuring it on the
 * writer's side at duration_bound.end says whether the encode produced it or the reader did.
 */
describe("lastPtsSecondsFromProbeOutput", () => {
  it("takes the last packet time and ignores blank lines and trailing commas", () => {
    expect(lastPtsSecondsFromProbeOutput("2509.888333,\n2509.909667,\n2509.931000,\n")).toBeCloseTo(2509.931, 6);
  });
  it("returns null when ffprobe printed nothing", () => {
    expect(lastPtsSecondsFromProbeOutput("")).toBeNull();
    expect(lastPtsSecondsFromProbeOutput("\n\n")).toBeNull();
  });
});

describe("resolveFeedAvLead", () => {
  it("is audio minus video in seconds, rounded to milliseconds", () => {
    expect(resolveFeedAvLead({ lastAudioPtsSeconds: 2508.22, lastVideoPtsSeconds: 2495.97 })).toEqual({
      lastAudioPtsSeconds: 2508.22,
      lastVideoPtsSeconds: 2495.97,
      audioLeadSeconds: 12.25
    });
  });
  it("is null when either stream is missing — a picture without sound is a different finding", () => {
    expect(resolveFeedAvLead({ lastAudioPtsSeconds: null, lastVideoPtsSeconds: 10 })).toBeNull();
  });
});
