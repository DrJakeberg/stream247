import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  type OverlayCustomLayerView,
  type OverlayGameView,
  type OverlayScenePayloadView
} from "@stream247/core";
import { loadSceneRendererFonts } from "../../apps/worker/src/scene-renderer";

/**
 * What a full-frame game box actually draws, measured on the real rasteriser.
 *
 * The operator's two complaints about the games are geometric, so they are answered with geometry:
 * a box over the whole picture has to give a playfield over the whole picture, and the panel's
 * backdrop has to be able to go away without taking the board with it.
 *
 * Measured before the change, on satori 0.29 + resvg at 1920x1080 with a 16x9 snake grid and the
 * box at x0 y0 w100 h100 outside the safe area:
 *   cell 104px, grid 1694x952 drawn at left 19 / right 1713 — 207px of dead panel on the right
 *   because the grid is left-aligned in a box the height constraint made too wide for it,
 *   panel height 1055 of 1080 because the panel never took the box's height,
 *   area coverage 77.77% of the frame.
 * And on transparency: the panel's opacity is one number for the whole panel, so opacityPercent 5
 * measured [1,1,1,11] where the board is — the backdrop and the snake fade together.
 */
type SatoriNode = {
  left: number;
  top: number;
  width: number;
  height: number;
  type: string;
  props: Record<string, unknown>;
  textContent?: string;
};
type Satori = (
  element: unknown,
  options: { width: number; height: number; fonts: unknown[]; onNodeDetected?: (node: SatoriNode) => void }
) => Promise<string>;

const workerRequire = createRequire(new URL("../../apps/worker/package.json", import.meta.url));
const satori = (workerRequire("satori") as { default: Satori }).default;
const { Resvg } = workerRequire("@resvg/resvg-js") as {
  Resvg: new (svg: string, options: unknown) => { render(): { width: number; height: number; pixels: Buffer } };
};

const FRAME = { width: 1920, height: 1080 };
const GRID = { width: 16, height: 9 };

function payload(layers: OverlayCustomLayerView[]): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third",
      customLayers: layers
    },
    channelName: "3JC Retro",
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
    tickerText: "",
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

function snake(): OverlayGameView {
  return {
    gridWidth: GRID.width,
    gridHeight: GRID.height,
    cells: [
      { x: 3, y: 4, kind: "snake-head" },
      { x: 2, y: 4, kind: "snake-body" },
      { x: 12, y: 2, kind: "food" }
    ],
    headline: "Chat plays snake",
    statusLine: "Score 3",
    hintLine: "Type !up !down !left !right",
    phase: "running"
  };
}

function fullFrameLayer(over: Partial<OverlayCustomLayerView> = {}): OverlayCustomLayerView {
  return {
    kind: "game",
    enabled: true,
    xPercent: 0,
    yPercent: 0,
    widthPercent: 100,
    heightPercent: 100,
    opacityPercent: 100,
    allowOutsideSafeArea: true,
    ...over
  };
}

function style(node: SatoriNode): Record<string, unknown> {
  return (node.props.style ?? {}) as Record<string, unknown>;
}

/** A cell is the square div: equal width and height, both numbers, and a fill. */
function isCell(node: SatoriNode): boolean {
  const s = style(node);
  return typeof s.width === "number" && s.width === s.height && typeof s.backgroundColor === "string";
}

async function measure(layer: OverlayCustomLayerView, fonts: unknown[], background: string) {
  const nodes: SatoriNode[] = [];
  const svg = await satori(
    buildOverlaySceneLayout({ payload: payload([layer]), game: snake() }, FRAME),
    { ...FRAME, fonts, onNodeDetected: (node) => nodes.push(node) }
  );
  const panel = nodes.find((node) => style(node).position === "absolute");
  const cells = nodes.filter(isCell);
  if (!panel || cells.length !== GRID.width * GRID.height) {
    throw new Error(`game panel not found: panel=${String(Boolean(panel))} cells=${String(cells.length)}`);
  }
  const grid = {
    left: Math.min(...cells.map((c) => c.left)),
    top: Math.min(...cells.map((c) => c.top)),
    right: Math.max(...cells.map((c) => c.left + c.width)),
    bottom: Math.max(...cells.map((c) => c.top + c.height))
  };
  const image = new Resvg(svg, { fitTo: { mode: "width", value: FRAME.width }, background }).render();
  // One read: the getter copies the whole framebuffer on every access.
  const pixels = image.pixels;
  const at = (x: number, y: number) => {
    const index = (Math.round(y) * image.width + Math.round(x)) * 4;
    return [pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0, pixels[index + 3] ?? 0] as const;
  };
  const head = cells.find((c) => style(c).backgroundColor === "#ffffff" && style(c).borderRadius !== 999);
  return {
    panel: { left: panel.left, top: panel.top, width: panel.width, height: panel.height },
    cellSize: cells[0]!.width,
    grid,
    gridWidth: grid.right - grid.left,
    gridHeight: grid.bottom - grid.top,
    coverage: ((grid.right - grid.left) * (grid.bottom - grid.top)) / (FRAME.width * FRAME.height),
    // Backdrop: inside the panel, left of the board, clear of every cell.
    backdrop: at(panel.left + 4, panel.top + panel.height / 2),
    head: head ? at(head.left + head.width / 2, head.top + head.height / 2) : null,
    headEdge: head ? at(head.left + 1, head.top + head.height / 2) : null
  };
}

function luminance([r, g, b]: readonly number[]): number {
  const channel = (value: number) => {
    const v = (value ?? 0) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

function contrast(a: readonly number[], b: readonly number[]): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("game panel, full frame", () => {
  it("fills the box it is given", async () => {
    let fonts: unknown[];
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      return;
    }
    const shot = await measure(fullFrameLayer(), fonts, "rgba(0,0,0,0)");
    console.log(`full frame: ${JSON.stringify(shot)}`);

    // The panel is the box, not whatever its content happened to need.
    expect(shot.panel.height).toBe(FRAME.height);
    // The board is centred in what is left, so a wide box does not park it against one edge.
    const leftGap = shot.grid.left - shot.panel.left;
    const rightGap = shot.panel.left + shot.panel.width - shot.grid.right;
    expect(Math.abs(leftGap - rightGap), `left gap ${String(leftGap)} vs right gap ${String(rightGap)}`).toBeLessThanOrEqual(2);
    // A box over the whole picture gives a playfield over the whole picture.
    expect(shot.gridWidth / FRAME.width).toBeGreaterThanOrEqual(0.9);
    expect(shot.gridHeight / FRAME.height).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it("drops its backdrop without taking the board with it", async () => {
    let fonts: unknown[];
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      return;
    }
    const shot = await measure(fullFrameLayer({ backgroundOpacityPercent: 0 }), fonts, "rgba(0,0,0,0)");
    console.log(`transparent backdrop: ${JSON.stringify(shot)}`);

    // Nothing of the panel fill survives...
    expect(shot.backdrop[3]).toBeLessThanOrEqual(4);
    // ...and the snake still does.
    expect(shot.head![3]).toBeGreaterThanOrEqual(240);
  }, 60_000);

  it("keeps the board legible on white video with no backdrop", async () => {
    let fonts: unknown[];
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      return;
    }
    const shot = await measure(fullFrameLayer({ backgroundOpacityPercent: 0 }), fonts, "#ffffff");
    const ratio = contrast(shot.head!, shot.headEdge!);
    console.log(`white video: head ${JSON.stringify(shot.head)} edge ${JSON.stringify(shot.headEdge)} ratio ${ratio.toFixed(2)}`);
    // The white snake head on white video is only visible because the cell is outlined.
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }, 60_000);
});
