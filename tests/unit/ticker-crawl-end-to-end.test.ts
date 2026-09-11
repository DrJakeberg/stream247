import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { overlayScale, overlayTickerCrawlPlan, type OverlayScenePayloadView } from "@stream247/core";
import { loadSceneRendererFonts, renderSceneFrame, renderTickerStrip } from "../../apps/worker/src/scene-renderer";
import { buildTickerCrawlFilter, resolveTickerCrawlCopies } from "../../apps/worker/src/ffmpeg-runtime";

/**
 * The whole ticker, end to end: the scene the rasteriser draws, the strip it draws beside it, and
 * the picture ffmpeg makes of the two.
 *
 * Every other test here measures one half. This one is the only place the halves meet, and the two
 * failures it exists to catch are the ones that look fine in isolation: a band drawn empty with
 * nothing crawling over it, and a line drawn twice — once standing in the scene and once moving
 * over it.
 */
const FRAME = { width: 1920, height: 1080 };
const FPS = 30;
const LINE = "Schedule at stream247.example";
const ffmpegAvailable = spawnSync("ffmpeg", ["-hide_banner", "-version"]).status === 0;

function payload(): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third",
      customLayers: []
    },
    channelName: "3JC Retro",
    accentColor: "#6ee7ff",
    brandLine: "STREAM247",
    heroLabel: "Now playing",
    heroTitle: "Advent of Code",
    heroBody: "",
    metaLine: "",
    nextLabel: "",
    nextTitle: "",
    nextTimeLabel: "",
    queueTitles: [],
    tickerText: LINE,
    tickerRotateSeconds: 20,
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}


/**
 * How far the picture moved between two frames, by matching one against the other.
 *
 * Not "where is the last ink": with the band tiled by several copies of the line, the rightmost
 * ink belongs to whichever copy happens to be furthest right, and a new copy entering makes that
 * measurement jump. Matching the whole scanline measures the motion itself.
 */
function shiftBetween(buf: Buffer, w: number, h: number, a: number, b: number, maxShift: number): number {
  const rowA = a * w * h + (h >> 1) * w;
  const rowB = b * w * h + (h >> 1) * w;
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let d = 0; d <= maxShift; d++) {
    let score = 0;
    for (let x = maxShift; x < w - maxShift; x += 2) {
      score += Math.abs(buf[rowA + x]! - buf[rowB + x - d]!);
    }
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

describe.runIf(ffmpegAvailable)("ticker crawl end to end", () => {
  it("draws the band once, the line once, and moves the line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ticker-e2e-"));
    const fonts = await loadSceneRendererFonts(process.env);
    const plan = overlayTickerCrawlPlan({ payload: payload() }, FRAME)!;

    const scenePng = join(dir, "scene.png");
    writeFileSync(
      scenePng,
      await renderSceneFrame({ payload: payload(), ...FRAME, tickerCrawl: plan.placement }, fonts)
    );
    const strip = (await renderTickerStrip(
      { line: plan.line, height: plan.crawl.height, scale: overlayScale(FRAME.width), typographyPreset: "studio-sans" },
      fonts
    ))!;
    const stripPng = join(dir, "strip.png");
    writeFileSync(stripPng, strip.png);

    const programme = join(dir, "programme.mp4");
    expect(
      spawnSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `color=c=0x202020:s=1920x1080:r=${FPS}:d=1`,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", programme
      ]).status
    ).toBe(0);

    // The production graph: the programme, the scene PNG over it, then the crawl over that.
    const crawl = buildTickerCrawlFilter({
      crawl: plan.crawl,
      pxPerSecond: plan.pxPerSecond,
      periodPx: strip.inkWidth + plan.gapPx,
      copies: resolveTickerCrawlCopies({ inkWidth: strip.inkWidth, gapPx: plan.gapPx, bandWidth: plan.crawl.width }).copies,
      stripInputIndex: 2,
      fps: FPS,
      from: "vscene",
      to: "vout"
    });
    const raw = join(dir, "band.raw");
    const run = spawnSync(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", programme,
        "-loop", "1", "-framerate", String(FPS), "-i", scenePng,
        "-loop", "1", "-framerate", String(FPS), "-i", stripPng,
        "-filter_complex",
        `[0:v][1:v]overlay=0:0:format=auto:shortest=1[vscene];${crawl};` +
          `[vout]crop=${plan.box.width}:${plan.box.height}:${plan.box.left}:${plan.box.top},format=gray[probe]`,
        "-map", "[probe]", "-f", "rawvideo", raw
      ],
      { timeout: 120_000, encoding: "buffer" }
    );
    expect({ status: run.status, err: String(run.stderr).slice(0, 300) }).toEqual({ status: 0, err: "" });

    const buf = readFileSync(raw);
    const w = plan.box.width;
    const h = plan.box.height;
    expect(buf.length / (w * h)).toBe(FPS);

    // The band is there: the scene PNG painted a dark bar where nothing was.
    expect(buf[0 * w * h + (h >> 1) * w + (w >> 1)]).toBeGreaterThan(0);
    // The line is there, and it moved by half a second of travel.
    const expected = Math.round(plan.pxPerSecond / 2);
    expect(shiftBetween(buf, w, h, 0, 15, expected + 20)).toBeCloseTo(expected, -1);

    // And it is drawn ONCE: the scene PNG alone must carry no white ink in the crawl run.
    const sceneOnly = spawnSync(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y", "-i", scenePng,
        "-vf", `crop=${plan.crawl.width}:${plan.crawl.height}:${plan.crawl.left}:${plan.crawl.top},format=gray`,
        "-frames:v", "1", "-f", "rawvideo", join(dir, "scene-band.raw")
      ],
      { timeout: 60_000 }
    );
    expect(sceneOnly.status).toBe(0);
    const band = readFileSync(join(dir, "scene-band.raw"));
    expect(band.some((value) => value > 200)).toBe(false);
  }, 240_000);
});
