import type { OverlaySceneCustomLayer } from "@stream247/core";

export type OverlayStyleMap = Record<string, string | number>;

function clampPercent(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveLiveOverlayStyle(outputWidth: number, outputHeight: number): OverlayStyleMap {
  const overlayScale = Math.min(1, Math.max(0.62, outputHeight / 720));
  const px = (value: number) => `${Math.round(value * overlayScale)}px`;

  return {
    "--overlay-width": `${outputWidth}px`,
    "--overlay-height": `${outputHeight}px`,
    "--overlay-output-width": `${outputWidth}px`,
    "--overlay-output-height": `${outputHeight}px`,
    "--overlay-scale": overlayScale.toFixed(3),
    "--overlay-gap": px(18),
    "--overlay-card-padding": px(20),
    "--overlay-card-large-padding": px(26),
    "--overlay-card-xl-padding": px(32),
    "--overlay-title-margin-top": px(10),
    "--overlay-title-margin-bottom": px(8),
    "--overlay-chip-padding-y": px(10),
    "--overlay-chip-padding-x": px(14),
    "--overlay-banner-padding-y": px(14),
    "--overlay-banner-padding-x": px(18),
    "--overlay-ticker-padding-y": px(12),
    "--overlay-ticker-padding-x": px(18),
    "--overlay-custom-text-padding-y": px(18),
    "--overlay-custom-text-padding-x": px(20),
    "--overlay-custom-widget-padding-y": px(20),
    "--overlay-custom-widget-padding-x": px(22)
  };
}

export function resolveOverlayCustomLayerStyle(layer: OverlaySceneCustomLayer): OverlayStyleMap {
  const xPercent = clampPercent(layer.xPercent, 0, 100);
  const yPercent = clampPercent(layer.yPercent, 0, 100);
  const widthPercent = clampPercent(layer.widthPercent, 0, 100 - xPercent);
  const heightPercent = clampPercent(layer.heightPercent, 0, 100 - yPercent);

  return {
    left: `calc(var(--safe-area-left-percent) + (var(--overlay-safe-area-width-percent) * ${xPercent} / 100))`,
    top: `calc(var(--safe-area-top-percent) + (var(--overlay-safe-area-height-percent) * ${yPercent} / 100))`,
    width: `calc(var(--overlay-safe-area-width-percent) * ${widthPercent} / 100)`,
    height: `calc(var(--overlay-safe-area-height-percent) * ${heightPercent} / 100)`,
    opacity: clampPercent(layer.opacityPercent, 0, 100) / 100
  };
}
