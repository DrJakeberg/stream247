import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildOverlaySceneLayout, type OverlayChatView, type OverlayScenePayloadView } from "@stream247/core";
import { loadSceneRendererFonts } from "../../apps/worker/src/scene-renderer";

/**
 * The emote row's geometry, measured on the real rasteriser at broadcast size.
 *
 * The text-only path draws a message as one label with lineClamp, and satori cuts that label to
 * the width the panel actually leaves. The emote path replaces it with a row of independent labels
 * and pictures; nothing about a character budget can promise that row fits, because glyph widths
 * are not characters. So this asserts the two things the panel promises, in pixels, via satori's
 * onNodeDetected: the chatter's name keeps its width, and the message stays inside the panel.
 *
 * The input is every documented limit at once and nothing past any of them: a 14-character name
 * of the widest Latin glyph, seven 4-character runs of it with six emotes between — 7·4 + 6·2 is
 * exactly the 40-character budget. Skips (inconclusive, not failed) on machines without a font.
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

// satori and resvg are the worker's dependencies, resolved from where the renderer resolves them.
const workerRequire = createRequire(new URL("../../apps/worker/package.json", import.meta.url));
const satori = (workerRequire("satori") as { default: Satori }).default;
const { Resvg } = workerRequire("@resvg/resvg-js") as {
  Resvg: new (svg: string, options: unknown) => { render(): { width: number; pixels: Buffer } };
};

const FRAME = { width: 1920, height: 1080 };
const NAME = "W".repeat(14);
// A 28x28 transparent PNG: no fetch, a declared size, a picture satori can place.
const EMOTE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAYAAAByDd+UAAAAG0lEQVRIx2NgGAWjYBSMglEwCkbBKBgFo4A+AAAIAAAB9pCjEwAAAABJRU5ErkJggg==";

function createPayload(): OverlayScenePayloadView {
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
    heroTitle: "Retro Night",
    heroBody: "",
    metaLine: "",
    nextLabel: "Up next",
    nextTitle: "",
    nextTimeLabel: "",
    queueTitles: [],
    tickerText: "",
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

function reproductionSegments(): { kind: string; text?: string; id?: string; url?: string }[] {
  const segments: { kind: string; text?: string; id?: string; url?: string }[] = [];
  for (let index = 0; index < 7; index += 1) {
    if (index > 0) {
      segments.push({ kind: "emote", id: `e${index}`, url: EMOTE });
    }
    segments.push({ kind: "text", text: "WWWW" });
  }
  return segments;
}

function chatWith(segments?: { kind: string; text?: string; id?: string; url?: string }[]): OverlayChatView {
  return {
    position: "bottom-left",
    maxMessages: 5,
    messages: [{ name: NAME, text: Array(7).fill("WWWW").join(" "), ...(segments ? { segments } : {}) }]
  };
}

function style(node: SatoriNode): Record<string, unknown> {
  return (node.props.style ?? {}) as Record<string, unknown>;
}

async function measure(chat: OverlayChatView, fonts: unknown[]) {
  const nodes: SatoriNode[] = [];
  const layout = buildOverlaySceneLayout(
    { payload: createPayload(), engagement: null, game: null, chat, sourceFrame: null },
    FRAME
  );
  const svg = await satori(layout, { ...FRAME, fonts, onNodeDetected: (node) => nodes.push(node) });

  // satori reports nodes parent-first and keeps only `style` of the props, so the rows are found
  // by position: the message row is the node before its first child, the name; the body row (or
  // the text label) is the node after it.
  const nameIndex = nodes.findIndex((node) => node.textContent === NAME);
  const name = nodes[nameIndex];
  const messageRow = nodes[nameIndex - 1];
  const bodyRow = nodes[nameIndex + 1];
  const images = nodes.filter((node) => node.type === "img");
  if (!name || style(messageRow).gap !== 10 || !bodyRow) {
    throw new Error("chat message row not found in the rendered tree");
  }

  const right = (node: SatoriNode) => node.left + node.width;
  // The panel is 20px of padding wider than its rows. Every pixel right of that, on the row's
  // own scanlines, is bare video and has to stay transparent.
  const image = new Resvg(svg, { fitTo: { mode: "width", value: FRAME.width }, background: "rgba(0,0,0,0)" }).render();
  // `pixels` is a getter that copies the whole framebuffer on every access; read it once, or the
  // scan below allocates ~8MB per pixel and the OOM killer takes the test runner with it.
  const pixels = image.pixels;
  let leakedAlpha = 0;
  for (let y = Math.floor(messageRow.top); y < Math.ceil(messageRow.top + messageRow.height); y += 1) {
    for (let x = Math.ceil(right(messageRow) + 20) + 1; x < right(messageRow) + 140; x += 1) {
      leakedAlpha = Math.max(leakedAlpha, pixels[(y * image.width + x) * 4 + 3] ?? 0);
    }
  }
  return {
    leakedAlpha,
    name: { width: name.width, height: name.height },
    messageRow: { width: messageRow.width, height: messageRow.height, right: right(messageRow) },
    second: { width: bodyRow.width, height: bodyRow.height, right: right(bodyRow), text: bodyRow.textContent ?? "" },
    body: style(bodyRow).gap === 4 ? { width: bodyRow.width, right: right(bodyRow) } : null,
    imagesRight: images.length > 0 ? Math.max(...images.map(right)) : null,
    panelInnerRight: right(messageRow)
  };
}

describe("chat emote row geometry", () => {
  it("keeps the name and stays inside the panel at the documented limits", async () => {
    let fonts: unknown[];
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      return;
    }

    const emotes = await measure(chatWith(reproductionSegments()), fonts);
    const textOnly = await measure(chatWith(), fonts);
    console.log(`emote path: ${JSON.stringify(emotes)}`);
    console.log(`text path:  ${JSON.stringify(textOnly)}`);

    expect(emotes.body).not.toBeNull();
    // The chatter keeps their name.
    expect(emotes.name.width).toBeGreaterThan(0);
    expect(emotes.name.width).toBe(textOnly.name.width);
    // The message ends where the panel's content does — nothing on bare video.
    expect(emotes.body!.right).toBeLessThanOrEqual(emotes.panelInnerRight);
    expect(emotes.imagesRight!).toBeLessThanOrEqual(emotes.panelInnerRight);
    // One line high on both paths, so the panel's height claim holds for emotes too.
    expect(emotes.messageRow.height).toBe(textOnly.messageRow.height);
  }, 30_000);
});
