import type { OverlaySceneCustomLayer } from "@stream247/core";
import { describe, expect, it } from "vitest";
import { resolveLiveOverlayStyle, resolveOverlayCustomLayerStyle } from "../../apps/web/lib/overlay-layout";

describe("live overlay safe-area wiring", () => {
  it("publishes output dimensions and overlay scale to CSS custom properties", () => {
    const style = resolveLiveOverlayStyle(640, 360) as Record<string, string>;

    expect(style["--overlay-width"]).toBe("640px");
    expect(style["--overlay-height"]).toBe("360px");
    expect(style["--overlay-output-width"]).toBe("640px");
    expect(style["--overlay-output-height"]).toBe("360px");
    expect(style["--overlay-scale"]).toBe("0.620");
  });

  it("clamps positioned custom layers to the safe-area bounds", () => {
    const layer: OverlaySceneCustomLayer = {
      id: "layer-overflow",
      kind: "text",
      name: "Now Playing",
      enabled: true,
      xPercent: 82,
      yPercent: 88,
      widthPercent: 32,
      heightPercent: 24,
      opacityPercent: 125,
      text: "Runtime parity",
      secondaryText: "",
      textTone: "headline",
      textAlign: "left",
      useAccent: false,
      fontMode: "preset",
      customFontFamily: ""
    };

    const style = resolveOverlayCustomLayerStyle(layer);

    expect(style.left).toBe("calc(var(--safe-area-left-percent) + (var(--overlay-safe-area-width-percent) * 82 / 100))");
    expect(style.top).toBe("calc(var(--safe-area-top-percent) + (var(--overlay-safe-area-height-percent) * 88 / 100))");
    expect(style.width).toBe("calc(var(--overlay-safe-area-width-percent) * 18 / 100)");
    expect(style.height).toBe("calc(var(--overlay-safe-area-height-percent) * 12 / 100)");
    expect(style.opacity).toBe(1);
  });
});
