import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { overlayTickerCrawlPlan, type OverlayScenePayloadView } from "@stream247/core";
import { buildTickerCrawlFilter } from "../../apps/worker/src/ffmpeg-runtime";
import { loadSceneRendererFonts, renderTickerStrip } from "../../apps/worker/src/scene-renderer";

/**
 * The crawl as ffmpeg actually runs it.
 *
 * Two things here can take the channel off air, and neither shows up in a string comparison. The
 * first is an ffmpeg that never exits: the crawl adds a looped image input and a colour source,
 * both infinite, to a graph whose only finite input is the programme. If the encode outlived the
 * programme, every block would hang and the channel would stop. The second is a graph ffmpeg
 * refuses at init, which fails the start outright.
 *
 * So this runs the real binary on a real two-second programme and measures the picture that comes
 * out: that it comes out at all, that it is exactly as long as what went in, and that the line
 * moved by the distance the plan asked for.
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
    heroLabel: "Now playing",
    heroTitle: "Advent of Code",
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

describe("ticker crawl filter", () => {
  it("wires the label it was given through to the one it was asked for", () => {
    const plan = overlayTickerCrawlPlan({ payload: payload("A line", 20) }, FRAME)!;
    const filter = buildTickerCrawlFilter({
      crawl: plan.crawl,
      pxPerSecond: plan.pxPerSecond,
      periodPx: 300 + plan.gapPx,
      stripInputIndex: 3,
      fps: FPS,
      from: "vscene",
      to: "vout"
    });
    expect(filter).toContain("[3:v]");
    expect(filter).toContain("[vscene]");
    expect(filter).toContain("[vout]");
    expect(filter).toContain(`-mod(t*${plan.pxPerSecond}`);
    expect(filter).toContain(String(300 + plan.gapPx));
    // The band ffmpeg draws into is the clear run inside the panel, not the panel.
    expect(filter).toContain(`overlay=x=${plan.crawl.left}:y=${plan.crawl.top}`);
    // Pinned here as well as measured below, because removing it looks harmless and is not:
    // overlay ends with its longest input, and both of this chain's own inputs are endless.
    expect(filter).toContain("shortest=1");
  });

  it.runIf(ffmpegAvailable)(
    "ends with the programme, and moves the line while it runs",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "ticker-crawl-"));
      const programme = join(dir, "programme.mp4");
      expect(
        spawnSync("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", `color=c=black:s=1920x1080:r=${FPS}:d=2`,
          "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", programme
        ]).status
      ).toBe(0);

      // A short line on purpose: its tail stays inside the band, so the tail IS the ruler.
      const plan = overlayTickerCrawlPlan({ payload: payload("Tail", 20) }, FRAME)!;
      const strip = (await renderTickerStrip(
        { line: plan.line, height: plan.crawl.height, scale: 1, typographyPreset: "studio-sans" },
        await loadSceneRendererFonts(process.env)
      ))!;
      const stripPath = join(dir, "strip.png");
      writeFileSync(stripPath, strip.png);
      expect(strip.inkWidth).toBeLessThan(plan.crawl.width);

      const filter = buildTickerCrawlFilter({
        crawl: plan.crawl,
        pxPerSecond: plan.pxPerSecond,
        periodPx: strip.inkWidth + plan.gapPx,
        stripInputIndex: 1,
        fps: FPS,
        from: "0:v",
        to: "vout"
      });
      const bandRaw = join(dir, "band.raw");
      const run = spawnSync(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", programme,
          "-loop", "1", "-framerate", String(FPS), "-i", stripPath,
          "-filter_complex",
          `${filter};[vout]crop=${plan.crawl.width}:${plan.crawl.height}:${plan.crawl.left}:${plan.crawl.top},format=gray[probe]`,
          "-map", "[probe]", "-f", "rawvideo", bandRaw
        ],
        { timeout: 120_000, encoding: "buffer" }
      );

      // The whole point: it exits, on its own, without the looped strip or the colour source
      // holding the encode open past the programme that ended.
      expect({ status: run.status, err: String(run.stderr).slice(0, 400) }).toEqual({ status: 0, err: "" });

      const { readFileSync } = await import("node:fs");
      const buf = readFileSync(bandRaw);
      const w = plan.crawl.width;
      const h = plan.crawl.height;
      const frames = buf.length / (w * h);
      expect(frames).toBe(2 * FPS);

      const tailAt = (frame: number) => {
        const base = frame * w * h;
        for (let x = w - 1; x >= 0; x--) {
          for (let y = 0; y < h; y++) {
            if (buf[base + y * w + x]! > 32) return x;
          }
        }
        return -1;
      };

      const first = tailAt(0);
      const later = tailAt(10);
      expect(first).toBeGreaterThan(0);
      // Ten frames at the planned rate, to within a pixel of rounding at each end.
      expect(Math.abs(first - later - Math.round((10 * plan.pxPerSecond) / FPS))).toBeLessThanOrEqual(2);
    },
    180_000
  );
});
