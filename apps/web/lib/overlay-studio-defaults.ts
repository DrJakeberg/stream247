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

  if (kind === "game") {
    // A wide box on the right: the default 16x9 snake grid wants roughly the frame's own aspect
    // ratio, and the right rail is where the layout already parks secondary panels.
    return {
      id,
      kind,
      name: "Chat Game",
      enabled: true,
      xPercent: 60,
      yPercent: 10,
      widthPercent: 30,
      heightPercent: 44,
      opacityPercent: 100,
      // The board keeps its backdrop until somebody turns it down; a game over bare video is a
      // choice, not a default.
      backgroundOpacityPercent: 100,
      allowOutsideSafeArea: false
    };
  }

  if (kind === "source") {
    // Corner box, picture-in-picture sized: a sampled camera wants to sit over the programme
    // without competing with the lower third.
    return {
      id,
      kind,
      name: "Video Source",
      enabled: true,
      xPercent: 64,
      yPercent: 8,
      widthPercent: 26,
      heightPercent: 26,
      opacityPercent: 100,
      allowOutsideSafeArea: false,
      sourceId: ""
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
