import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { overlayScale } from "@stream247/core";
import { loadSceneRendererFonts, renderTickerStrip } from "../../apps/worker/src/scene-renderer";


/**
 * The strip ffmpeg crawls, measured on the real rasteriser.
 *
 * This is the one picture in the overlay whose width is not a design decision: the period of the
 * crawl is the ink's own width plus a gap, so a strip that reports a width its pixels disagree
 * with produces either a visible seam every pass or a stutter where the gap should be. Reported
 * width against painted pixels is therefore the whole test.
 *
 * The pixel buffer is read ONCE into a local. resvg's `pixels` is a getter that copies the entire
 * framebuffer on every access, and a scan loop that touches it per pixel allocated 21GB and had
 * the kernel kill the test runner.
 */
const { Resvg } = createRequire(new URL("../../apps/worker/package.json", import.meta.url))("@resvg/resvg-js") as {
  Resvg: new (svg: string, options: unknown) => { render(): { width: number; height: number; pixels: Buffer } };
};

const SCALE = overlayScale(1920);
const HEIGHT = 58;

async function strip(line: string) {
  const fonts = await loadSceneRendererFonts(process.env);
  return renderTickerStrip({ line, height: HEIGHT, scale: SCALE, typographyPreset: "studio-sans" }, fonts);
}

/** The painted columns of a rendered strip: first and last column carrying any opaque pixel. */
function inkColumns(svg: string, width: number): { first: number; last: number; painted: number } {
  const image = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(0,0,0,0)" }).render();
  const pixels = image.pixels;
  const w = image.width;
  const h = image.height;
  let first = -1;
  let last = -1;
  let painted = 0;
  for (let x = 0; x < w; x++) {
    let hit = false;
    for (let y = 0; y < h; y++) {
      if (pixels[(y * w + x) * 4 + 3]! > 16) {
        hit = true;
        break;
      }
    }
    if (hit) {
      painted++;
      if (first < 0) first = x;
      last = x;
    }
  }
  return { first, last, painted };
}

describe("ticker strip", () => {
  it("reports the width its own pixels end at", async () => {
    const made = await strip("The line that crawls across the band");
    const ink = inkColumns(made.svg, made.width);

    expect(ink.first).toBeGreaterThanOrEqual(0);
    // Exactly, not approximately: the reported width is measured on these very pixels, so any
    // difference at all would mean the two scans disagree about what counts as painted.
    expect(made.inkWidth).toBe(ink.last + 1);
  }, 30_000);

  it("starts at the left edge, give or take the first glyph's own bearing", async () => {
    // Measured here: the ink starts at column 2, which is the left side bearing of the L and not a
    // padding. What this rules out is an inset big enough to shorten the visible run.
    const made = await strip("Left edge");
    expect(inkColumns(made.svg, made.width).first).toBeLessThanOrEqual(4);
  }, 30_000);

  it("never lets the line reach the edge of its own canvas", async () => {
    const long = "x".repeat(180);
    const made = await strip(long);
    expect(made.inkWidth).toBeLessThan(made.width);
    expect(inkColumns(made.svg, made.width).last).toBeLessThan(made.width - 1);
  }, 30_000);

  it("grows with the line, because the period has to", async () => {
    const short = await strip("Short");
    const long = await strip("Short but then a great deal longer than that");
    expect(long.inkWidth).toBeGreaterThan(short.inkWidth);
  }, 30_000);

  it("is exactly as tall as the crawl area it runs through", async () => {
    const made = await strip("Height check");
    expect(made.height).toBe(HEIGHT);
    const image = new Resvg(made.svg, { fitTo: { mode: "width", value: made.width }, background: "rgba(0,0,0,0)" }).render();
    expect(image.height).toBe(HEIGHT);
  }, 30_000);

  it("has nothing to draw for an empty line", async () => {
    expect(await strip("")).toBeNull();
    expect(await strip("   ")).toBeNull();
  }, 30_000);
});
