import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Contrast is checked here rather than in a browser because it is pure arithmetic on the declared
// values: deterministic, fast, and it fails on the pull request that introduces the bad pair rather
// than when someone squints at a screenshot.
//
// The thresholds are WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text and for the boundary of
// a UI component (borders, focus rings) that has to be findable.

const cssPath = path.resolve(import.meta.dirname, "../../apps/web/app/globals.css");
const css = readFileSync(cssPath, "utf8");

type Rgb = { r: number; g: number; b: number };

function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "");
  const expanded = hex.length === 3 ? [...hex].map((char) => char + char).join("") : hex;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(expanded)) {
    return null;
  }
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16)
  };
}

/** Flattens a translucent colour onto an opaque backdrop, which is what the eye actually sees. */
function composite(foreground: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return {
    r: foreground.r * alpha + backdrop.r * (1 - alpha),
    g: foreground.g * alpha + backdrop.g * (1 - alpha),
    b: foreground.b * alpha + backdrop.b * (1 - alpha)
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/**
 * Reads a custom property and returns the opaque colour it actually renders as.
 *
 * Several surfaces are declared translucent (`--surface: rgba(255, 252, 246, 0.9)`), so measuring
 * the declared value alone would report a contrast nobody experiences. Translucent tokens are
 * flattened onto the given backdrop, which is what sits behind them in the layout.
 */
function readToken(name: string, backdrop?: Rgb): Rgb {
  const match = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!match?.[1]) {
    throw new Error(`Design token --${name} is not defined in globals.css`);
  }

  const raw = match[1].trim();
  const hex = parseHex(raw);
  if (hex) {
    return hex;
  }

  const rgba = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!rgba) {
    throw new Error(`Design token --${name} is neither hex nor rgb(a): ${raw}`);
  }

  const colour: Rgb = { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) };
  const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
  if (alpha >= 1) {
    return colour;
  }

  if (!backdrop) {
    throw new Error(`Design token --${name} is translucent; a backdrop is required to measure it.`);
  }

  return composite(colour, alpha, backdrop);
}

describe("contrastRatio", () => {
  it("matches the known reference points", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    const a = { r: 14, g: 109, b: 90 };
    const b = { r: 242, g: 238, b: 229 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe("composite", () => {
  it("returns the backdrop at zero alpha and the foreground at full alpha", () => {
    const fg = { r: 10, g: 20, b: 30 };
    const bg = { r: 200, g: 210, b: 220 };
    expect(composite(fg, 0, bg)).toEqual(bg);
    expect(composite(fg, 1, bg)).toEqual(fg);
  });
});

describe("declared colour pairs", () => {
  const bg = readToken("bg");
  // Panels sit on the app background, so that is what their translucency reveals.
  const surface = readToken("surface", bg);

  it("body text is readable on both the app background and panels", () => {
    const text = readToken("text");
    expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("muted text still clears the body-text threshold", () => {
    // Muted is used for real content (timestamps, source names, incident detail), not decoration,
    // so it is held to 4.5:1 rather than the large-text allowance.
    const muted = readToken("muted");
    expect(contrastRatio(muted, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("the brand colour is readable as text and usable as a boundary", () => {
    const brand = readToken("brand");
    expect(contrastRatio(brand, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(brand, bg)).toBeGreaterThanOrEqual(3);
  });

  it("white on the brand colour is readable, which is what the primary button relies on", () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, readToken("brand"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the channel page's programme cards keep their text and their accent readable", () => {
    // The public channel page sets programme titles in --text and times in --muted on
    // --surface-strong items, and marks the on-air card with a --brand border. The pairs predate
    // the visual pass; they are asserted now because the page's hierarchy leans on them.
    const strong = readToken("surface-strong");
    expect(contrastRatio(readToken("text"), strong)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readToken("muted"), strong)).toBeGreaterThanOrEqual(4.5);
    // The border is a boundary, not text: 3:1.
    expect(contrastRatio(readToken("brand"), strong)).toBeGreaterThanOrEqual(3);
  });

  it("state colours are readable on the surfaces they appear on", () => {
    for (const token of ["danger", "warning"]) {
      expect(contrastRatio(readToken(token), surface), `--${token} on --surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(readToken(token), bg), `--${token} on --bg`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("stylesheet hygiene", () => {
  it("does not suppress focus outlines without providing a replacement", () => {
    // Removing the outline with nothing in its place makes the workspace unusable by keyboard,
    // which matters most in exactly the situation where it is needed: something is broken and the
    // operator is moving fast.
    // Comments are stripped first: they sit between the previous rule and the selector, so a
    // documented rule would otherwise be reported as "/*" and the message would name nothing.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}");

    // An `outline: none` is acceptable in two cases: the same rule supplies its own indicator, or
    // an ancestor takes it over via :focus-within (a ring around an input nested inside an already
    // bordered box reads as a rendering glitch). Anything else leaves focus invisible.
    const hasWrapperIndicator = (selector: string): boolean => {
      const baseClass = selector.match(/\.([a-z0-9-]+)/i)?.[1];
      if (!baseClass) {
        return false;
      }

      // ".chip-input-field" is covered by a ":focus-within" rule on any of its class prefixes.
      return rules.some((rule) => {
        const head = rule.split("{")[0] ?? "";
        if (!head.includes(":focus-within")) {
          return false;
        }
        const wrapper = head.match(/\.([a-z0-9-]+):focus-within/i)?.[1];
        return Boolean(wrapper && baseClass.startsWith(wrapper) && /box-shadow|border|background|outline/.test(rule));
      });
    };

    const offenders = rules
      .filter((rule) => /outline:\s*none/.test(rule))
      .filter((rule) => !/box-shadow|outline-offset|border-color|background/.test(rule))
      .map((rule) => rule.split("{")[0]?.trim() ?? "unknown")
      .filter((selector) => !hasWrapperIndicator(selector));

    expect(offenders, `selectors dropping focus visibility: ${offenders.join(", ")}`).toEqual([]);
  });
});
