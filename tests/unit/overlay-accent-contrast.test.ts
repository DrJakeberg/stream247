import { describe, expect, it } from "vitest";
import { accentInkColor, accentTextColor } from "@stream247/core";

/**
 * The chip an operator can make unreadable.
 *
 * The overlay's label chip is filled with the accent colour from the channel's settings and used to
 * be lettered "#05070c" regardless. On the default cyan that is crisp; on a dark accent it is
 * invisible. And this is the one surface nobody inside the product looks at — it is only visible to
 * whoever is watching the stream.
 *
 * The contrast maths lives here rather than being imported, so a change to the picker has to face
 * the numbers rather than a helper that already agrees with it.
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

/** The default, plus the corners an operator can actually reach in the colour picker. */
const ACCENTS = [
  "#6ee7ff",
  "#000000",
  "#ffffff",
  "#0e6d5a",
  "#9e2430",
  "#101010",
  "#fafafa",
  "#7c3aed",
  "#facc15",
  "#1f2937"
];

describe("the on-air label chip stays readable", () => {
  it.each(ACCENTS)("%s carries legible ink", (accent) => {
    const ink = accentInkColor(accent);

    // 4.5:1 — the chip holds the channel name and the scene label, which are text, not decoration.
    expect(contrastRatio(ink, accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("picks the better of the two rather than a fixed one", () => {
    expect(accentInkColor("#6ee7ff")).toBe("#05070c");
    expect(accentInkColor("#1f2937")).toBe("#ffffff");
    expect(accentInkColor("#000000")).toBe("#ffffff");
    expect(accentInkColor("#ffffff")).toBe("#05070c");
  });

  it("falls back to dark ink when the accent is not a colour it can read", () => {
    expect(accentInkColor("not-a-colour")).toBe("#05070c");
    expect(accentInkColor("")).toBe("#05070c");
  });

  it("handles the short hex form the picker also accepts", () => {
    expect(accentInkColor("#000")).toBe("#ffffff");
    expect(accentInkColor("#fff")).toBe("#05070c");
  });
});

describe("headings lettered in the accent stay readable on the panel", () => {
  // The panel fill as if opaque: it is 72-94% over moving video, so this is the darkest it gets,
  // which is where a dark accent fails hardest.
  const PANEL = "#080a0f";

  it.each(ACCENTS)("%s is either used or replaced, never left illegible", (accent) => {
    expect(contrastRatio(accentTextColor(accent), PANEL)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the channel's colour whenever it can be read", () => {
    // Branding is not something to take away for safety when the choice was fine.
    expect(accentTextColor("#6ee7ff")).toBe("#6ee7ff");
    expect(accentTextColor("#facc15")).toBe("#facc15");
  });

  it("replaces it only when it cannot", () => {
    expect(accentTextColor("#0e6d5a")).toBe("#ffffff");
    expect(accentTextColor("#1f2937")).toBe("#ffffff");
    expect(accentTextColor("#000000")).toBe("#ffffff");
  });
});
