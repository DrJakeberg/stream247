import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  deriveDefaultPlacements,
  OVERLAY_PANEL_IDS,
  type OverlayChatView,
  type OverlayEngagementView,
  type OverlayPanelId,
  type OverlayScenePayloadView
} from "@stream247/core";
import { loadSceneRendererFonts } from "../../apps/worker/src/scene-renderer";

/**
 * One placement model for every panel, measured where it matters: on the rasteriser, in pixels.
 *
 * The built-in panels used to hang in a flex flow with no placement and no opacity of their own,
 * and the operator's complaint was exactly that — the fields could not be moved. They now take the
 * same percent box a custom layer takes, resolved by the same resolvePlacementBox. Two things have
 * to hold for that to be safe.
 *
 * First, nothing moves on its own: a scene with no placements is the tree that was on air before,
 * which overlay-golden-frames.test.ts checks by checksum. Here the complement is checked — that the
 * boxes deriveDefaultPlacements hands the studio put each panel back where the flow had it.
 *
 * Second, a placed panel fits its box instead of growing out of it. In the flow that was free:
 * panels displaced each other. A box has nothing to displace, so the chat panel reads its message
 * count out of its own height and the vote panel its option count, the way the game panel has
 * always read its cell size.
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

const FRAME = { width: 1920, height: 1080 };
const FROZEN_AT = new Date("2026-02-01T21:30:00.000Z");

function basePayload(): OverlayScenePayloadView {
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
    queueTitles: [],
    tickerText: "",
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

function chatWith(position: string, count = 2): OverlayChatView {
  return {
    position,
    maxMessages: 12,
    messages: Array.from({ length: count }, (_, index) => ({ name: `viewer_${String(index)}`, text: "hello there" }))
  };
}

const engagement: OverlayEngagementView = {
  kind: "vote-next",
  headline: "What runs next?",
  options: Array.from({ length: 5 }, (_, index) => ({ token: String(index + 1), title: `Option ${String(index + 1)}`, votes: 10 })),
  totalVotes: 50,
  secondsRemaining: 40,
  threshold: 0,
  hint: "Type 1 or 2 in chat"
};

function style(node: SatoriNode): Record<string, unknown> {
  return (node.props.style ?? {}) as Record<string, unknown>;
}

/**
 * Finds each built-in panel in the rendered tree by the one style property that identifies it.
 * A placed panel keeps its own styles and gains an absolutely positioned parent, so the same
 * predicates find it in both layouts and the boxes are directly comparable.
 */
function panels(nodes: SatoriNode[]): Partial<Record<OverlayPanelId, SatoriNode>> {
  const find = (predicate: (s: Record<string, unknown>) => boolean) => nodes.find((node) => predicate(style(node)));
  return {
    hero: find((s) => s.maxWidth === 1180 || (s.maxWidth !== undefined && s.padding === "26px 34px")),
    vote: find((s) => s.flexDirection === "column" && s.padding === "22px 24px"),
    next: find((s) => s.flexDirection === "column" && s.padding === "16px 20px" && s.borderRadius === 16 && s.maxWidth !== undefined),
    chat: find((s) => s.flexDirection === "column" && s.padding === "16px 20px" && s.width !== undefined),
    clock: find((s) => s.borderRadius === 999 && s.fontSize === 26),
    banner: find((s) => s.backgroundColor === "rgba(190,32,48,0.94)")
  };
}

async function render(input: Parameters<typeof buildOverlaySceneLayout>[0], fonts: unknown[]) {
  const nodes: SatoriNode[] = [];
  await satori(buildOverlaySceneLayout(input, { ...FRAME, now: FROZEN_AT }), {
    ...FRAME,
    fonts,
    onNodeDetected: (node) => nodes.push(node)
  });
  return nodes;
}

async function fonts(): Promise<unknown[] | null> {
  try {
    return await loadSceneRendererFonts(process.env);
  } catch {
    return null;
  }
}

describe("built-in panel placement", () => {
  it.each([
    ["bottom anchor, chat bottom-left", "bottom", "bottom-left"],
    ["bottom anchor, chat bottom-right", "bottom", "bottom-right"],
    ["bottom anchor, chat top-left", "bottom", "top-left"],
    ["bottom anchor, chat top-right", "bottom", "top-right"],
    ["centre anchor", "center", "bottom-left"]
  ])("the derived defaults put every panel back where the flow had it: %s", async (_name, anchor, chatPosition) => {
    const loaded = await fonts();
    if (!loaded) {
      return;
    }
    const scene = { ...basePayload().scene, panelAnchor: anchor };
    const chat = chatWith(chatPosition);
    const flow = panels(
      await render({ payload: { ...basePayload(), scene }, chat, engagement }, loaded)
    );
    const derived = deriveDefaultPlacements(anchor, chatPosition, { vote: true });
    const placed = panels(
      await render(
        { payload: { ...basePayload(), scene: { ...scene, panelPlacements: derived } }, chat, engagement },
        loaded
      )
    );

    const drift: Record<string, { dx: number; dy: number }> = {};
    for (const id of OVERLAY_PANEL_IDS) {
      const before = flow[id];
      const after = placed[id];
      if (!before || !after) {
        continue;
      }
      drift[id] = { dx: after.left - before.left, dy: after.top - before.top };
    }
    console.log(`${anchor}/${chatPosition}: ${JSON.stringify(drift)}`);

    if (anchor === "center") {
      // The centre anchor centres the whole column, so where the flow puts a panel is a function of
      // everything else on the frame. The derived boxes centre the panels themselves; the two
      // answers agree on the axis that is anchored and differ vertically by the column's own slack.
      for (const id of ["hero", "vote", "clock"] as const) {
        expect(drift[id]!.dx).toBe(0);
        expect(Math.abs(drift[id]!.dy)).toBeLessThanOrEqual(96);
      }
      return;
    }

    // At the bottom anchor — the default, and what is on air — every panel lands on the same pixel,
    // the chat panel included, whichever corner it was put in. The one exception is a chat panel at
    // a top position: the flow drops it into the middle band because the root justifies its rows
    // space-between, and the derived box puts it under the clock where a "top" chat belongs.
    const exact: OverlayPanelId[] =
      chatPosition === "top-left" || chatPosition === "top-right" ? ["hero", "vote", "clock"] : ["hero", "vote", "clock", "chat"];
    for (const id of exact) {
      expect(drift[id], `${id} has no box in one of the two renders`).toBeDefined();
      expect(drift[id], `${id} moved`).toEqual({ dx: 0, dy: 0 });
    }
  }, 60_000);

  it("gives each panel its own opacity, clamped the way every other placement is", async () => {
    const loaded = await fonts();
    if (!loaded) {
      return;
    }
    const derived = deriveDefaultPlacements("bottom", "bottom-left");
    const tree = buildOverlaySceneLayout(
      {
        payload: {
          ...basePayload(),
          scene: {
            ...basePayload().scene,
            panelPlacements: {
              hero: { ...derived.hero, opacityPercent: 40 },
              // Below the floor every custom layer has always been held to.
              clock: { ...derived.clock, opacityPercent: 1 }
            }
          }
        }
      },
      { ...FRAME, now: FROZEN_AT }
    );
    const opacities: number[] = [];
    const walk = (node: unknown) => {
      const value = node as { props?: { style?: Record<string, unknown>; children?: unknown } };
      if (value.props?.style?.opacity !== undefined && value.props.style.position === "absolute") {
        opacities.push(Number(value.props.style.opacity));
      }
      const children = value.props?.children;
      if (Array.isArray(children)) {
        children.forEach(walk);
      } else if (children && typeof children === "object") {
        walk(children);
      }
    };
    walk(tree);
    expect(opacities.sort((a, b) => a - b)).toEqual([0.05, 0.4]);
  });

  it("reads the chat message count out of the box height instead of a fixed budget", async () => {
    const loaded = await fonts();
    if (!loaded) {
      return;
    }
    const derived = deriveDefaultPlacements("bottom", "bottom-left");
    const rows = async (heightPercent: number) => {
      const nodes = await render(
        {
          payload: {
            ...basePayload(),
            scene: { ...basePayload().scene, panelPlacements: { chat: { ...derived.chat, heightPercent } } }
          },
          chat: chatWith("bottom-left", 8)
        },
        loaded
      );
      const panel = panels(nodes).chat;
      // Message rows are the panel's own children: flex rows with the 10px name/body gap.
      return { drawn: nodes.filter((node) => style(node).gap === 10).length, height: panel?.height ?? 0 };
    };

    // 27.5% of the 968px safe area is 266px, the height eight messages measured.
    const full = await rows(27.5);
    // A third of that holds two.
    const short = await rows(9);
    console.log(`chat rows: full ${JSON.stringify(full)} short ${JSON.stringify(short)}`);
    expect(full.drawn).toBe(8);
    expect(short.drawn).toBe(2);
    expect(short.height).toBeLessThanOrEqual(Math.round((9 / 100) * (1080 - 112)));
  }, 60_000);

  it("drops the vote options that would not fit its box", async () => {
    const loaded = await fonts();
    if (!loaded) {
      return;
    }
    const derived = deriveDefaultPlacements("bottom", "bottom-left");
    const drawn = async (heightPercent: number) => {
      const nodes = await render(
        {
          payload: {
            ...basePayload(),
            scene: { ...basePayload().scene, panelPlacements: { vote: { ...derived.vote, heightPercent } } }
          },
          engagement
        },
        loaded
      );
      const panel = panels(nodes).vote;
      return {
        options: nodes.filter((node) => style(node).marginBottom === 14 && style(node).flexDirection === "column").length,
        height: panel?.height ?? 0
      };
    };

    // 38.2% of 968 is 370px, the height five options measured.
    const five = await drawn(38.2);
    // 23% is 222px: header, hint and padding are 115, so two options at 51 each and 5px to spare.
    const two = await drawn(23);
    console.log(`vote options: five ${JSON.stringify(five)} two ${JSON.stringify(two)}`);
    expect(five.options).toBe(5);
    expect(two.options).toBe(2);
    expect(two.height).toBeLessThanOrEqual(Math.round((23 / 100) * (1080 - 112)));
  }, 60_000);
});
