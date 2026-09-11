import { describe, expect, it } from "vitest";
import { describeTickerCrawlStaleness } from "@stream247/core";

/**
 * Telling the operator that their ticker edit has not reached the screen.
 *
 * The line is one image the encoder moves, made when a programme starts, and the period it moves by
 * is derived from that line's own ink — so a new text needs a new graph and the graph is fixed for
 * the life of the process. On a channel playing assets that is a few minutes. On the standby slate
 * or a live bridge, which run until the selection changes, there may be no next programme at all,
 * and the only way to replace the line is a playout restart, which interrupts the stream.
 *
 * Nothing said so. The operator typed a correction, watched the studio preview update, and had no
 * way to learn that the channel was still running the old line — possibly for hours. This does not
 * fix that; it makes it visible, which is the difference between a documented limitation and a
 * silent one.
 */
describe("ticker crawl staleness", () => {
  it("is quiet while the line on air is the line that is configured", () => {
    expect(describeTickerCrawlStaleness({ crawlLine: "Schedule at example", payloadLine: "Schedule at example" })).toEqual({
      stale: false
    });
  });

  it("is quiet when nothing is crawling, because then the line is drawn at rest and is current", () => {
    expect(describeTickerCrawlStaleness({ crawlLine: "", payloadLine: "Anything at all" })).toEqual({ stale: false });
  });

  it("names both lines when the configured text has moved on", () => {
    expect(
      describeTickerCrawlStaleness({ crawlLine: "Back at 22:00", payloadLine: "CORRECTION: back at 23:00" })
    ).toEqual({
      stale: true,
      onAir: "Back at 22:00",
      configured: "CORRECTION: back at 23:00"
    });
  });

  it("counts a cleared ticker as stale, because the old line keeps crawling", () => {
    // The band belongs to the process while a crawl runs, so clearing the field does not take the
    // line away — it keeps going over the video until the next programme.
    expect(describeTickerCrawlStaleness({ crawlLine: "Back at 22:00", payloadLine: "" })).toEqual({
      stale: true,
      onAir: "Back at 22:00",
      configured: ""
    });
  });

  it("ignores whitespace, so a stray space is not an incident", () => {
    expect(
      describeTickerCrawlStaleness({ crawlLine: "Back at 22:00", payloadLine: "  Back at 22:00  " })
    ).toEqual({ stale: false });
  });
});
