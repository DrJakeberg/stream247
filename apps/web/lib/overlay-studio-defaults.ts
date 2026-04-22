import type { OverlaySceneCustomLayerKind } from "@stream247/core";
import type { OverlaySettingsRecord } from "./server/state";

type OverlayDraftCustomLayer = OverlaySettingsRecord["customLayers"][number];

function createSceneCustomLayerId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultCustomLayer(kind: OverlaySceneCustomLayerKind): OverlayDraftCustomLayer {
  const id = createSceneCustomLayerId();

  if (kind === "text") {
    return {
      id,
      kind,
      name: "Text Layer",
      enabled: true,
      xPercent: 4,
      yPercent: 10,
      widthPercent: 34,
      heightPercent: 16,
      opacityPercent: 100,
      allowOutsideSafeArea: false,
      text: "Fresh scene copy",
      secondaryText: "",
      textTone: "headline",
      textAlign: "left",
      useAccent: false,
      fontMode: "preset",
      customFontFamily: ""
    };
  }

  if (kind === "logo") {
    return {
      id,
      kind,
      name: "Logo Layer",
      enabled: true,
      xPercent: 76,
      yPercent: 8,
      widthPercent: 16,
      heightPercent: 12,
      opacityPercent: 100,
      allowOutsideSafeArea: false,
      url: "",
      altText: "",
      fit: "contain"
    };
  }

  if (kind === "image") {
    return {
      id,
      kind,
      name: "Image Layer",
      enabled: true,
      xPercent: 62,
      yPercent: 10,
      widthPercent: 28,
      heightPercent: 24,
      opacityPercent: 100,
      allowOutsideSafeArea: false,
      url: "",
      altText: "",
      fit: "cover"
    };
  }

  if (kind === "widget") {
    return {
      id,
      kind,
      name: "Widget Layer",
      enabled: true,
      xPercent: 56,
      yPercent: 8,
      widthPercent: 38,
      heightPercent: 28,
      opacityPercent: 100,
      allowOutsideSafeArea: false,
      url: "",
      title: "",
      widgetMode: "embed",
      widgetDataKey: "current"
    };
  }

  return {
    id,
    kind: "embed",
    name: "Embed Layer",
    enabled: true,
    xPercent: 56,
    yPercent: 8,
    widthPercent: 38,
    heightPercent: 28,
    opacityPercent: 100,
    allowOutsideSafeArea: false,
    url: "",
    title: "Embed frame"
  };
}
