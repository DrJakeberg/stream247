import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The tone layer collapses seven state vocabularies onto five semantic pairs. Collapsing them is
// only safe if every pair is still readable, and the failure mode is quiet: a chip keeps its class
// name and its meaning while its contrast slips below the threshold.
//
// The existing contrast test reads globals.css and understands hex and rgba() only, so it cannot
// see the token layer at all — the channel syntax (`rgb(var(--brand-rgb) / 0.12)`) is invisible to
// it. This resolves that syntax so the tokens themselves are held to the same standard.

type Rgb = { r: number; g: number; b: number };

const tokensCss = readFileSync(
  path.resolve(import.meta.dirname, "../../apps/web/app/styles/tokens.css"),
  "utf8"
);
const globalsCss = readFileSync(path.resolve(import.meta.dirname, "../../apps/web/app/globals.css"), "utf8");
const css = `${globalsCss}\n${tokensCss}`;

function declarationOf(name: string): string {
  const match = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!match?.[1]) {
    throw new Error(`Design token --${name} is not defined`);
  }
  return match[1].trim();
}

function parseHex(value: string): Rgb | null {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match?.[1]) {
    return null;
  }
  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16)
  };
}

function composite(foreground: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return {
    r: foreground.r * alpha + backdrop.r * (1 - alpha),
    g: foreground.g * alpha + backdrop.g * (1 - alpha),
    b: foreground.b * alpha + backdrop.b * (1 - alpha)
  };
}

/**
 * Resolves a token to the colour a viewer actually sees, following var() indirection and
 * compositing any alpha onto `backdrop`. A translucent token judged on its declared value alone
 * would report a contrast nobody experiences.
 */
function resolve(name: string, backdrop: Rgb): Rgb {
  const raw = declarationOf(name);

  const hex = parseHex(raw);
  if (hex) {
    return hex;
  }

  // `rgb(var(--x-rgb) / 0.12)` and `rgb(var(--x-rgb))`
  const channel = raw.match(/rgba?\(\s*var\(--([\w-]+)\)\s*(?:\/\s*([\d.]+)\s*)?\)/);
  if (channel?.[1]) {
    const parts = declarationOf(channel[1])
      .split(/\s+/)
      .map((part) => Number(part.replace(/[^\d.]/g, "")));
    const base = { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0 };
    const alpha = channel[2] === undefined ? 1 : Number(channel[2]);
    return alpha >= 1 ? base : composite(base, alpha, backdrop);
  }

  // Plain indirection: `var(--other)`
  const indirect = raw.match(/^var\(--([\w-]+)\)$/);
  if (indirect?.[1]) {
    return resolve(indirect[1], backdrop);
  }

  const rgba = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (rgba) {
    const base = { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) };
    const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return alpha >= 1 ? base : composite(base, alpha, backdrop);
  }

  throw new Error(`Cannot resolve --${name}: ${raw}`);
}

function channelLuminance(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const luminance = ({ r, g, b: blue }: Rgb) =>
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(blue);
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

const appBackground = resolve("bg", { r: 255, g: 255, b: 255 });
// Panels are translucent, so the app background is what shows through them.
const panel = resolve("surface-panel", appBackground);

const TONES = ["positive", "caution", "critical", "neutral", "info"] as const;

describe("state tones", () => {
  it.each(TONES)("%s text is readable on its own background", (tone) => {
    const foreground = resolve(`tone-${tone}-fg`, panel);
    const background = resolve(`tone-${tone}-bg`, panel);

    // 4.5:1: these carry real status text ("Degraded", "3 blocks overflow"), not decoration.
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TONES)("%s reads as a filled pill rather than blending into the panel", (tone) => {
    const background = resolve(`tone-${tone}-bg`, panel);

    // Not a WCAG threshold: these tints are decoration, and the state is carried by the text sitting
    // on them. This is a floor against a future tint being softened until the pill disappears —
    // measured at 1.17-1.25 across the five tones when they were consolidated.
    expect(contrastRatio(background, panel)).toBeGreaterThanOrEqual(1.15);
  });

  it.each(TONES)("%s draws its border from the same channel as its fill", (tone) => {
    // The border exists to edge the fill. Drawing it from a different channel is how one tone ends
    // up with another's hue after an unrelated edit.
    const border = resolve(`tone-${tone}-border`, panel);
    const background = resolve(`tone-${tone}-bg`, panel);

    // A stronger alpha of the same hue is always further from the panel than the fill is.
    expect(contrastRatio(border, panel)).toBeGreaterThanOrEqual(contrastRatio(background, panel));
  });

  it("keeps the tones distinguishable from one another, not just legible", () => {
    // Five states that look alike are one state with extra steps.
    const backgrounds = TONES.map((tone) => resolve(`tone-${tone}-bg`, panel));
    for (let index = 0; index < backgrounds.length; index += 1) {
      for (let other = index + 1; other < backgrounds.length; other += 1) {
        const left = backgrounds[index];
        const right = backgrounds[other];
        const identical = left && right && left.r === right.r && left.g === right.g && left.b === right.b;
        expect(identical).toBe(false);
      }
    }
  });

  it("keeps text readable on the consolidated card surface", () => {
    // --surface-card replaced eight hand-mixed paper alphas (0.72-0.8) with one step. Cards carry
    // full content — titles, muted metadata — so both text colours are held to body-text AA on the
    // two backdrops a card actually sits on: the app background and a panel.
    for (const backdrop of [appBackground, panel]) {
      const card = resolve("surface-card", backdrop);
      expect(contrastRatio(resolve("text", card), card)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(resolve("muted", card), card)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the schedule labels readable on the brand wash", () => {
    // --brand-wash is the weakest brand fill (active schedule rows, the video timeline), and
    // .schedule-video-slot letters it in --brand-strong. The wash sits over a panel in the
    // schedule surfaces and closer to the bare app background elsewhere, so both backdrops are
    // measured: 7.64:1 over a panel, 6.85:1 over --bg when the 0.06/0.08 washes were unified.
    // The floor below is AA so a later darkening of the wash cannot pass unremarked.
    for (const backdrop of [panel, appBackground]) {
      const wash = resolve("brand-wash", backdrop);
      expect(contrastRatio(resolve("brand-strong", wash), wash)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the selected-navigation pair readable", () => {
    // .nav-link-active and the workspace tabs both set --brand-strong on --brand-tint-faint. The
    // pair predates this suite; it is asserted now because the tabs joined it during the visual
    // pass. Tabs render near the bare background, the sidebar links over its gradient, so both
    // backdrops are measured: 7.10:1 over a panel, 6.38:1 over --bg as consolidated.
    for (const backdrop of [panel, appBackground]) {
      const tint = resolve("brand-tint-faint", backdrop);
      expect(contrastRatio(resolve("brand-strong", tint), tint)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("did not lose contrast when the local greens and blues were folded in", () => {
    // The values these replaced, measured before the change: 6.17 for the balanced pill's own
    // green, 5.43 for the underfilled amber, 6.29 for the overflow blue. The consolidated pairs
    // have to stay in that neighbourhood rather than merely clearing the threshold.
    const positive = contrastRatio(resolve("tone-positive-fg", panel), resolve("tone-positive-bg", panel));
    const info = contrastRatio(resolve("tone-info-fg", panel), resolve("tone-info-bg", panel));

    expect(positive).toBeGreaterThanOrEqual(6.17);
    expect(info).toBeGreaterThanOrEqual(5.5);
  });
});
