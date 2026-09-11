import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { overlayScale, overlayTickerCrawlPlan, type OverlayScenePayloadView } from "@stream247/core";
import { buildTickerCrawlFilter, resolveTickerCrawlCopies } from "../../apps/worker/src/ffmpeg-runtime";
import { loadSceneRendererFonts, renderTickerStrip } from "../../apps/worker/src/scene-renderer";

/**
 * Whether the line actually covers the band, measured across a WHOLE crawl period.
 *
 * The first version of this laid the strip down exactly twice, one period apart, and every test
 * passed. Two copies reach at most `2*ink + gap` — so for any line shorter than the band, the
 * right-hand part of the band was never painted at any instant, and at each wrap the second copy
 * appeared in the MIDDLE of the band instead of entering at its right edge. Measured on the
 * ordinary case, "Welcome to the stream" at 1080p: the rightmost column ever painted was 961 of a
 * 1722-wide band, 760px of permanently black bar, and a 598px jump every 6.75 seconds. Which is
 * exactly the teleport the crawl exists to remove.
 *
 * The suite could not see it because its ffmpeg probe ran two seconds and one wrap takes nearly
 * seven. So this test runs a FULL period and asks the only question that matters: does the line
 * reach the right-hand edge of the band, and does it ever jump?
 */
const FRAME = { width: 1920, height: 1080 };
const FPS = 30;
const ffmpegAvailable = spawnSync("ffmpeg", ["-hide_banner", "-version"]).status === 0;

function payload(ticker: string, seconds: number): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third",
      customLayers: []
    },
    channelName: "3JC",
    accentColor: "#6ee7ff",
    brandLine: "STREAM247",
    heroLabel: "",
    heroTitle: "",
    heroBody: "",
    metaLine: "",
    nextLabel: "",
    nextTitle: "",
    nextTimeLabel: "",
    queueTitles: [],
    tickerText: ticker,
    tickerRotateSeconds: seconds,
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

/** The whole pipeline for one line, run for a full period, reduced to what the band ever shows. */
async function measureBand(line: string) {
  const dir = mkdtempSync(join(tmpdir(), "ticker-cov-"));
  const fonts = await loadSceneRendererFonts(process.env);
  // The fastest legible speed, so a full period fits in a short encode.
  const plan = overlayTickerCrawlPlan({ payload: payload(line, 4) }, FRAME)!;
  const scale = overlayScale(FRAME.width);
  const strip = (await renderTickerStrip(
    { line: plan.line, height: plan.crawl.height, scale, typographyPreset: "studio-sans" },
    fonts
  ))!;
  const tiling = resolveTickerCrawlCopies({ inkWidth: strip.inkWidth, gapPx: plan.gapPx, bandWidth: plan.crawl.width });
  const stripPath = join(dir, "strip.png");
  writeFileSync(stripPath, strip.png);

  const seconds = Math.ceil(tiling.periodPx / plan.pxPerSecond) + 1;
  const raw = join(dir, "band.raw");
  const run = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=black:s=1920x1080:r=${FPS}:d=${seconds}`,
      "-loop", "1", "-framerate", String(FPS), "-i", stripPath,
      "-filter_complex",
      `${buildTickerCrawlFilter({
        crawl: plan.crawl,
        pxPerSecond: plan.pxPerSecond,
        periodPx: tiling.periodPx,
        copies: tiling.copies,
        stripInputIndex: 1,
        fps: FPS,
        from: "0:v",
        to: "vout"
      })};[vout]crop=${plan.crawl.width}:${plan.crawl.height}:${plan.crawl.left}:${plan.crawl.top},format=gray[probe]`,
      "-map", "[probe]", "-f", "rawvideo", raw
    ],
    { timeout: 240_000, encoding: "buffer" }
  );
  expect({ status: run.status, err: String(run.stderr).slice(0, 300) }).toEqual({ status: 0, err: "" });

  const buf = readFileSync(raw);
  const w = plan.crawl.width;
  const h = plan.crawl.height;
  const frames = buf.length / (w * h);
  let rightmostEver = -1;
  const leadingEdges: number[] = [];
  for (let f = 0; f < frames; f++) {
    const base = f * w * h;
    let last = -1;
    for (let x = w - 1; x >= 0; x--) {
      let hit = false;
      for (let y = 0; y < h; y++) {
        if (buf[base + y * w + x]! > 200) {
          hit = true;
          break;
        }
      }
      if (hit) {
        last = x;
        break;
      }
    }
    if (last > rightmostEver) rightmostEver = last;
    leadingEdges.push(last);
  }
  return { plan, tiling, ink: strip.inkWidth, frames, rightmostEver, leadingEdges, width: w };
}

describe.runIf(ffmpegAvailable)("ticker crawl coverage", () => {
  it("reaches the right-hand edge of the band with an ordinary short notice", async () => {
    const m = await measureBand("Welcome to the stream");
    expect(m.ink).toBeLessThan(m.width);
    // Within one glyph of the edge: the line must ENTER at the band's right edge, not appear inside it.
    expect(m.width - 1 - m.rightmostEver).toBeLessThanOrEqual(20);
  }, 300_000);

  it("never lets the leading edge appear inside the band", async () => {
    const m = await measureBand("Welcome to the stream");
    // A forward jump means a copy materialised where there was nothing. Entering at the edge is
    // not a jump: it lands within a glyph of the right edge.
    const jumps = m.leadingEdges
      .map((edge, index) => ({ index, jump: index > 0 ? edge - m.leadingEdges[index - 1]! : 0, edge }))
      .filter((step) => step.jump > 24 && step.edge < m.width - 24);
    expect(jumps).toEqual([]);
  }, 300_000);
});
