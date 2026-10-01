import { describe, expect, it } from "vitest";
import {
  SNAKE_GAME_DEFINITION,
  accentInkColor,
  accentTextColor,
  buildOverlaySceneLayout,
  createDefaultChatGameSettings,
  type OverlayLayoutNode,
  type OverlayScenePayloadView
} from "@stream247/core";

/**
 * The game panel is burned into the broadcast, so its words and colours answer to the on-air
 * standard: no operator vocabulary in anything a viewer can read, and 4.5:1 for every piece of
 * text on the panel. Both are checked against what the layout actually emits, not against
 * constants that could drift away from it.
 */

const OPERATOR_WORDS = [
  "playout",
  "runtime",
  "worker",
  "uplink",
  "queue preview",
  "payload",
  "snapshot",
  "metadata",
  "configured",
  "unavailable",
  "not available"
];

const SETTINGS = createDefaultChatGameSettings();

describe("game wording that ends up on air", () => {
  it("keeps operator vocabulary out of every line, in both phases", () => {
    const playing = SNAKE_GAME_DEFINITION.renderModel(SNAKE_GAME_DEFINITION.createInitialState(SETTINGS, 1), SETTINGS);
    const over = SNAKE_GAME_DEFINITION.renderModel(
      { ...SNAKE_GAME_DEFINITION.createInitialState(SETTINGS, 1), phase: "over" },
      SETTINGS
    );

    const offenders: string[] = [];
    for (const model of [playing, over]) {
      for (const line of [model.headline, model.statusLine, model.hintLine]) {
        if (OPERATOR_WORDS.some((word) => line.toLowerCase().includes(word))) {
          offenders.push(line);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("tells the room the score when a round ends", () => {
    const over = SNAKE_GAME_DEFINITION.renderModel(
      { ...SNAKE_GAME_DEFINITION.createInitialState(SETTINGS, 1), phase: "over", score: 7 },
      SETTINGS
    );

    expect(over.statusLine).toContain("Game over");
    expect(over.statusLine).toContain("7");
  });

  it("names the configured emotes in the hint, so the instruction is literally playable", () => {
    const custom = {
      ...SETTINGS,
      emoteMap: { up: "hoch", down: "runter", left: "links", right: "rechts" }
    };
    const model = SNAKE_GAME_DEFINITION.renderModel(SNAKE_GAME_DEFINITION.createInitialState(custom, 1), custom);

    for (const emote of Object.values(custom.emoteMap)) {
      expect(model.hintLine).toContain(emote);
    }
  });
});

/**
 * Contrast maths lives here rather than being imported, matching the accent-contrast test: a
 * change to the panel colours has to face the numbers, not a helper that already agrees with it.
 */
function relativeLuminance(hex: string): number {
  const channel = (start: number) => {
    const value = parseInt(hex.replace("#", "").slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrastRatio(left: string, right: string): number {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Composites rgba(255,255,255,alpha) text over the opaque panel fill. */
function whiteOverPanel(alpha: number, panel: string): string {
  const blend = (start: number) => {
    const base = parseInt(panel.replace("#", "").slice(start, start + 2), 16);
    return Math.round(alpha * 255 + (1 - alpha) * base)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${blend(0)}${blend(2)}${blend(4)}`;
}

const PANEL = "#080a0f";

function collectStyledText(
  node: OverlayLayoutNode | OverlayLayoutNode[] | string | undefined
): { text: string; style: Record<string, unknown> }[] {
  if (typeof node === "string" || !node) {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectStyledText);
  }
  const children = node.props.children;
  if (typeof children === "string") {
    return [{ text: children, style: node.props.style ?? {} }];
  }
  return collectStyledText(children);
}

describe("game panel text stays readable on the panel", () => {
  // The corners an operator can reach in the accent picker, dark accents included.
  const ACCENTS = ["#6ee7ff", "#000000", "#ffffff", "#1f2937", "#facc15"];

  function buildGamePanelTexts(accent: string) {
    const payload: OverlayScenePayloadView = {
      scene: {
        surfaceStyle: "solid",
        panelAnchor: "bottom",
        titleScale: "balanced",
        typographyPreset: "studio-sans",
        resolvedPresetId: "lower-third",
        customLayers: [
          {
            kind: "game",
            enabled: true,
            xPercent: 62,
            yPercent: 8,
            widthPercent: 26,
            heightPercent: 40,
            opacityPercent: 100,
            allowOutsideSafeArea: false
          }
        ]
      },
      channelName: "",
      accentColor: accent,
      brandLine: "",
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
      timeZone: "UTC"
    };
    const game = SNAKE_GAME_DEFINITION.renderModel(SNAKE_GAME_DEFINITION.createInitialState(SETTINGS, 5), SETTINGS);
    const layout = buildOverlaySceneLayout({ payload, game }, { width: 1920, height: 1080, now: new Date(0) });
    const model = { headline: game.headline.toUpperCase(), statusLine: game.statusLine, hintLine: game.hintLine };
    return { texts: collectStyledText(layout), model };
  }

  it.each(ACCENTS)("headline and score chip clear 4.5:1 with accent %s", (accent) => {
    const { texts, model } = buildGamePanelTexts(accent);

    const headline = texts.find((entry) => entry.text.includes(model.headline));
    expect(headline).toBeDefined();
    expect(contrastRatio(String(headline!.style.color), PANEL)).toBeGreaterThanOrEqual(4.5);

    const chip = texts.find((entry) => entry.text === model.statusLine);
    expect(chip).toBeDefined();
    // The chip is filled with the accent, so its ink is measured against the accent, not the panel.
    expect(chip!.style.backgroundColor).toBe(accent);
    expect(chip!.style.color).toBe(accentInkColor(accent));
    expect(contrastRatio(String(chip!.style.color), accent)).toBeGreaterThanOrEqual(4.5);

    // Sanity: the headline uses the measured accent-or-white rule, not the raw accent.
    expect(headline!.style.color).toBe(accentTextColor(accent));
  });

  it("keeps the hint line above 4.5:1 for its configured alpha", () => {
    const { texts, model } = buildGamePanelTexts("#6ee7ff");
    const hint = texts.find((entry) => entry.text === model.hintLine);

    expect(hint).toBeDefined();
    const match = /rgba\(255,255,255,(?<alpha>[0-9.]+)\)/.exec(String(hint!.style.color));
    expect(match?.groups?.alpha).toBeDefined();
    expect(contrastRatio(whiteOverPanel(Number(match!.groups!.alpha), PANEL), PANEL)).toBeGreaterThanOrEqual(4.5);
  });
});
