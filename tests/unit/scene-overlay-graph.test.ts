import { describe, expect, it } from "vitest";
import { buildSceneOverlayFilterComplex, buildSourceLivePipFilterComplex } from "../../apps/worker/src/ffmpeg-runtime";

/**
 * The scene overlay graph, which three separate command builders used to spell out for themselves.
 *
 * They agreed, and that was luck rather than design: the same overlay string was written out three
 * times in index.ts, none of the three was reachable from a test, and the ticker crawl has to be
 * threaded through every one of them or the band draws empty wherever it was missed. So the string
 * moves here, where it can be measured, and the three builders call it.
 */
const CRAWL = {
  crawl: { left: 102, top: 160, width: 1776, height: 58 },
  pxPerSecond: 89,
  periodPx: 540,
  stripInputIndex: 3,
  fps: 30
};

describe("scene overlay graph", () => {
  it("overlays the scene pipe on the programme and calls it vout", () => {
    expect(buildSceneOverlayFilterComplex({ outputVideoFilter: "", sceneInputIndex: 1, ticker: null })).toBe(
      "[0:v][1:v]overlay=0:0:format=auto[vout]"
    );
  });

  it("puts the output scaler in front of the overlay, exactly where it was", () => {
    expect(buildSceneOverlayFilterComplex({ outputVideoFilter: "scale=1280:720", sceneInputIndex: 2, ticker: null })).toBe(
      "[0:v]scale=1280:720[base];[base][2:v]overlay=0:0:format=auto[vout]"
    );
  });

  it("hands the scene to the crawl instead of to the muxer when a ticker is running", () => {
    const graph = buildSceneOverlayFilterComplex({ outputVideoFilter: "", sceneInputIndex: 1, ticker: CRAWL });
    // The scene no longer ends the graph; the crawl does, and the crawl draws onto the scene.
    expect(graph).toContain("[0:v][1:v]overlay=0:0:format=auto[vscene]");
    expect(graph).toContain("[vscene][tkband]");
    expect(graph.endsWith("[vout]")).toBe(true);
    expect(graph).toContain("[3:v]");
    expect(graph).toContain("shortest=1");
  });

  it("leaves the picture-in-picture graph exactly as it was without a ticker", () => {
    const parts = buildSourceLivePipFilterComplex({
      outputVideoFilter: "",
      sceneInputIndex: 1,
      pipInputIndex: 2,
      fps: 30,
      box: { left: 10, top: 20, width: 640, height: 360 },
      audio: null,
      ticker: null
    });
    expect(parts.filterComplex.endsWith("[vpip][1:v]overlay=0:0:format=auto[vout]")).toBe(true);
  });

  it("crawls the ticker over the picture-in-picture too", () => {
    const parts = buildSourceLivePipFilterComplex({
      outputVideoFilter: "",
      sceneInputIndex: 1,
      pipInputIndex: 2,
      fps: 30,
      box: { left: 10, top: 20, width: 640, height: 360 },
      audio: null,
      ticker: CRAWL
    });
    expect(parts.filterComplex).toContain("[vpip][1:v]overlay=0:0:format=auto[vscene]");
    expect(parts.filterComplex).toContain("[vscene][tkband]");
    expect(parts.filterComplex.endsWith("[vout]")).toBe(true);
  });

  it("keeps the audio mix behind the video, with the crawl in between neither of them", () => {
    const parts = buildSourceLivePipFilterComplex({
      outputVideoFilter: "",
      sceneInputIndex: 1,
      pipInputIndex: 2,
      fps: 30,
      box: { left: 10, top: 20, width: 640, height: 360 },
      audio: { programLabel: "[0:a]", programVolume: 1, sourceGain: 1 },
      ticker: CRAWL
    });
    expect(parts.audioMapped).toBe(true);
    expect(parts.filterComplex).toContain("[aout]");
    expect(parts.filterComplex.indexOf("[tkband]")).toBeLessThan(parts.filterComplex.indexOf("[aout]"));
  });
});
