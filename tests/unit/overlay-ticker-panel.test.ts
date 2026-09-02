import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  deriveDefaultPlacements,
  overlayTickerLine,
  resolvePlacementPixelBox,
  OVERLAY_PANEL_IDS,
  OVERLAY_TICKER_FILL_ALPHA,
  type OverlayScenePayloadView
} from "@stream247/core";
import { loadSceneRendererFonts, sceneFrameCacheKey } from "../../apps/worker/src/scene-renderer";

/**
 * The ticker panel, measured on the real rasteriser.
 *
 * The payload has carried tickerText since the first overlay and the renderer has never drawn it.
 * Measured on this rasteriser before any of this existed, the layout checksum was identical with
 * the text set, cleared, and replaced — 0eca45b0776bab1f in all three cases. So the text reached
 * the picture nowhere, and turning it into a panel is a change to the picture.
 *
 * What it can be is decided by the update rate, not by taste. The renderer redraws on
 * SCENE_RENDER_INTERVAL_MS, default 2000ms and floored at 1000ms, so the on-air picture changes at
 * most 0.5-1 times per second; the 1fps pipe only re-pushes the cached PNG in between. Measured
 * here: a Latin glyph at fontSize 24 advances 14.24px, so crossing the 1776px safe area in 30s at
 * the default rate is 118.4px per frame — 8.3 characters of sideways teleport per step, and 2.1 at
 * the fastest configuration with the slowest crossing anybody would accept. There is no crawl to
 * build. A rotating ticker holds one message still for its dwell and is therefore sharp at 0.5fps.
 *
 * Which makes the frame cache the load-bearing part: sceneFrameCacheKey carries no clock, so a
 * ticker that advances without moving the key would never be re-rasterised at all.
 */
const FROZEN_AT = new Date("2026-02-01T21:30:00.000Z");

/** The golden lower-third layout checksum, recorded before the ticker panel existed. */
const TICKERLESS_LAYOUT_CHECKSUM = "0eca45b0776bab1f";

type SatoriNode = { left: number; top: number; width: number; height: number; type: string; textContent?: string };
type Satori = (
  element: unknown,
  options: { width: number; height: number; fonts: unknown[]; onNodeDetected?: (node: SatoriNode) => void }
) => Promise<string>;

const renderRequire = createRequire(new URL("../../packages/render/package.json", import.meta.url));
const satori = (renderRequire("satori") as { default: Satori }).default;
const { Resvg } = createRequire(new URL("../../apps/worker/package.json", import.meta.url))("@resvg/resvg-js") as {
  Resvg: new (svg: string, options: unknown) => { render(): { width: number; pixels: Buffer } };
};

const FRAME = { width: 1920, height: 1080 };

function payload(ticker: string, rotateSeconds?: number): OverlayScenePayloadView {
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
    heroTitle: "Advent of Code 2025",
    heroBody: "Recorded live",
    metaLine: "Programming",
    nextLabel: "Up next",
    nextTitle: "Retro Night",
    nextTimeLabel: "21:30",
    queueTitles: ["Prime time replay", "Late night standby"],
    tickerText: ticker,
    tickerRotateSeconds: rotateSeconds,
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function request(ticker: string, now: Date, rotateSeconds?: number) {
  return { payload: payload(ticker, rotateSeconds), ...FRAME, now };
}

describe("ticker panel", () => {
  it("draws nothing, and nothing moves, while the ticker text is empty", () => {
    const tree = buildOverlaySceneLayout({ payload: payload("") }, { ...FRAME, now: FROZEN_AT });
    expect(checksum(JSON.stringify(tree))).toBe(TICKERLESS_LAYOUT_CHECKSUM);
  });

  it("is a panel like every other one", () => {
    expect(OVERLAY_PANEL_IDS).toContain("ticker");
    const box = deriveDefaultPlacements("bottom", "bottom-left").ticker;
    expect(box).toBeDefined();
    expect(box.opacityPercent).toBe(100);

    // Its default box may not sit on top of another panel's default box. Measured against the
    // three that share the frame with it — the lower third and the clock, which the frame always
    // draws, and the emergency banner, whose box is the deepest thing in the top bar. Measured in
    // resolved pixels rather than percents, because the resolver floors every box at 8% of the
    // safe area and the first attempt at this default overlapped the clock by exactly that floor.
    const mine = resolvePlacementPixelBox(box, FRAME);
    for (const other of ["hero", "clock", "banner"] as const) {
      const theirs = resolvePlacementPixelBox(deriveDefaultPlacements("bottom", "bottom-left")[other], FRAME);
      const overlaps =
        mine.left < theirs.left + theirs.width &&
        theirs.left < mine.left + mine.width &&
        mine.top < theirs.top + theirs.height &&
        theirs.top < mine.top + mine.height;
      expect({ other, overlaps }).toEqual({ other, overlaps: false });
    }
  });

  it("holds one message for its dwell and then shows the next", () => {
    const text = "First notice · Second notice · Third notice";
    const at = (seconds: number) => overlayTickerLine(payload(text, 8), new Date(seconds * 1000));

    // Inside one dwell the drawn line does not move; at the boundary it steps to the next message.
    expect(at(0)).toBe(at(7));
    expect(at(8)).not.toBe(at(0));
    expect(new Set([at(0), at(8), at(16)]).size).toBe(3);
    // And it comes back round rather than running out.
    expect(at(24)).toBe(at(0));
    // A single message is not a rotation; it is a line that stands.
    expect(overlayTickerLine(payload("Only one", 8), new Date(0))).toBe("Only one");
    expect(overlayTickerLine(payload("Only one", 8), new Date(999_000))).toBe("Only one");
    expect(overlayTickerLine(payload(""), new Date(0))).toBe("");
  });

  it("moves the frame cache key when it advances, and never otherwise", () => {
    const text = "First notice · Second notice";
    const key = (seconds: number) => sceneFrameCacheKey(request(text, new Date(seconds * 1000), 8));
    expect(key(0)).toBe(key(7));
    expect(key(8)).not.toBe(key(0));

    // An empty ticker must leave the key exactly as it was, or every cached frame in the fleet
    // re-rasterises for a panel that draws nothing.
    const empty = (seconds: number) => sceneFrameCacheKey(request("", new Date(seconds * 1000)));
    expect(empty(0)).toBe(empty(999));
    // As must a single message: nothing about it changes over time.
    const single = (seconds: number) => sceneFrameCacheKey(request("Only one", new Date(seconds * 1000), 8));
    expect(single(0)).toBe(single(999));
  });
});

/**
 * Contrast maths, written out here rather than imported, the way the game panel's wording test
 * does it: a change to the ticker's colours has to face the numbers, not a helper that already
 * agrees with it.
 */
function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Composites `over` at `alpha` on top of `under`. */
function composite(
  over: { r: number; g: number; b: number },
  alpha: number,
  under: { r: number; g: number; b: number }
) {
  return {
    r: over.r * alpha + under.r * (1 - alpha),
    g: over.g * alpha + under.g * (1 - alpha),
    b: over.b * alpha + under.b * (1 - alpha)
  };
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };
/** The panel fill the overlay's surfaces are built from. */
const FILL = { r: 8, g: 10, b: 15 };

describe("ticker legibility over moving video", () => {
  it("clears 4.5:1 against the worst video the panel can sit on", () => {
    // The ticker paints its own fill rather than borrowing a surface style, because the surface
    // styles are tuned for panels a viewer looks at on purpose. This one is read in passing over
    // whatever the programme happens to be showing, so the fill is stated here and measured.
    const alpha = OVERLAY_TICKER_FILL_ALPHA;
    const ink = WHITE;

    for (const [name, video] of [
      ["white video", WHITE],
      ["black video", BLACK]
    ] as const) {
      const background = composite(FILL, alpha, video);
      const ratio = contrastRatio(ink, background);
      console.log(`ticker ink over ${name}: ${ratio.toFixed(2)}:1 (fill alpha ${String(alpha)})`);
      expect({ name, pass: ratio >= 4.5 }).toEqual({ name, pass: true });
    }

    // The reference the brief names: the game panel's repaired hint line, white on the opaque fill.
    console.log(`ticker ink over the opaque fill: ${contrastRatio(WHITE, FILL).toFixed(2)}:1`);
  });
});

/**
 * Measures the drawn ticker on the rasteriser: where satori put its box, and whether any pixel of
 * it landed outside that box.
 */
async function measure(text: string, fonts: unknown[], rotateSeconds?: number) {
  const nodes: SatoriNode[] = [];
  const tree = buildOverlaySceneLayout({ payload: payload(text, rotateSeconds) }, { ...FRAME, now: FROZEN_AT });
  const svg = await satori(tree, { ...FRAME, fonts, onNodeDetected: (node) => nodes.push(node) });

  const box = resolvePlacementPixelBox(deriveDefaultPlacements("bottom", "bottom-left").ticker, FRAME);

  const image = new Resvg(svg, { fitTo: { mode: "width", value: FRAME.width }, background: "rgba(0,0,0,0)" }).render();
  // `pixels` is a getter that copies the whole framebuffer on every access. Read it once: the scan
  // below touches millions of offsets, and re-reading would allocate ~8MB each time.
  const pixels = image.pixels;
  const alphaAt = (x: number, y: number) => pixels[(y * image.width + x) * 4 + 3] ?? 0;

  // Anything painted on the ticker's own scanlines, right of its box, is the panel escaping.
  let leakedRight = 0;
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left + box.width + 1; x < FRAME.width; x += 1) {
      leakedRight = Math.max(leakedRight, alphaAt(x, y));
    }
  }
  // And anything painted just below it is the panel growing taller than the box it was given.
  let leakedBelow = 0;
  for (let y = box.top + box.height + 1; y < Math.min(FRAME.height, box.top + box.height + 40); y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      leakedBelow = Math.max(leakedBelow, alphaAt(x, y));
    }
  }

  let painted = 0;
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      if (alphaAt(x, y) > 0) {
        painted += 1;
      }
    }
  }

  const widest = nodes.filter((node) => typeof node.textContent === "string" && node.textContent.length > 0);
  return { box, leakedRight, leakedBelow, painted, textNodes: widest.length };
}

describe("ticker panel on the rasteriser", () => {
  it("paints inside its box, and paints nothing without a text", async () => {
    let fonts: unknown[];
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      // No font on this machine; the renderer could not start either.
      return;
    }

    const set = await measure("Stream247 keeps the channel on air around the clock", fonts);
    const empty = await measure("", fonts);
    console.log(`ticker set:   ${JSON.stringify(set)}`);
    console.log(`ticker empty: ${JSON.stringify(empty)}`);

    expect(set.painted).toBeGreaterThan(0);
    expect(set.leakedRight).toBe(0);
    expect(set.leakedBelow).toBe(0);
    expect(empty.painted).toBe(0);
  }, 60_000);

  it("keeps a too-long line and full-width glyphs inside the box", async () => {
    let fonts: unknown[];
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      return;
    }

    // 180 characters is what the store keeps (sanitizeStoredText caps ticker_text there), so this
    // is the longest single message that can ever reach the renderer. The CJK line is the same
    // length in characters and nearly double in pixels, which is the case a character budget misses.
    const longest = "Stream247 stays on air around the clock and this notice runs far too long for one line".padEnd(180, ".");
    const wide = "配信は二十四時間ずっと続いています".repeat(11).slice(0, 180);

    const long = await measure(longest.slice(0, 180), fonts);
    const cjk = await measure(wide, fonts);
    console.log(`ticker 180 latin: ${JSON.stringify(long)}`);
    console.log(`ticker wide cjk:  ${JSON.stringify(cjk)}`);

    expect(long.painted).toBeGreaterThan(0);
    expect(long.leakedRight).toBe(0);
    expect(long.leakedBelow).toBe(0);
    expect(cjk.painted).toBeGreaterThan(0);
    expect(cjk.leakedRight).toBe(0);
    expect(cjk.leakedBelow).toBe(0);
  }, 60_000);
});
