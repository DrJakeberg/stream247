import { expect } from "vitest";
import { EN_VIEWER_MESSAGES, type OverlayLayoutNode, type OverlayScenePreset } from "@stream247/core";

// Shared by the M80 viewer-language tests. Not a test file itself, so importing it does not run
// any test twice.

/** The overlay settings an install that never touched them stores (packages/db column defaults). */
export function storedDefaults(scenePreset: OverlayScenePreset = "split-now-next") {
  return {
    channelName: "Stream247",
    replayLabel: "Replay stream",
    brandBadge: "",
    accentColor: "#0e6d5a",
    scenePreset,
    insertScenePreset: "bumper-board" as OverlayScenePreset,
    standbyScenePreset: "standby-board" as OverlayScenePreset,
    reconnectScenePreset: "reconnect-board" as OverlayScenePreset,
    headline: "Always on air",
    insertHeadline: "Insert on air",
    standbyHeadline: "Please wait, restream is starting",
    reconnectHeadline: "Scheduled reconnect in progress",
    surfaceStyle: "glass" as const,
    panelAnchor: "bottom" as const,
    titleScale: "balanced" as const,
    typographyPreset: "studio-sans" as const,
    showClock: true,
    showNextItem: true,
    showScheduleTeaser: true,
    showCurrentCategory: true,
    showSourceLabel: true,
    showQueuePreview: true,
    queuePreviewCount: 2,
    emergencyBanner: "",
    tickerText: "",
    tickerRotateSeconds: 8,
    layerOrder: [],
    disabledLayers: [],
    customLayers: []
  };
}

/** The English sentences of the catalogue that must never reach a German viewer. */
export function englishSentenceFragments(): string[] {
  const fragments = new Set<string>();
  for (const message of Object.values(EN_VIEWER_MESSAGES)) {
    for (const form of typeof message === "string" ? [message] : Object.values(message)) {
      for (const fragment of form.split(/\{[A-Za-z]+\}/)) {
        const trimmed = fragment.trim().replace(/^[·:—,.!?\s]+|[·:—,.!?\s]+$/g, "");
        // Two words or more: a lone name ("Snake", "Stream247") is the same in German by design.
        if (/[A-Za-z]{2,}\s+[A-Za-z]/.test(trimmed)) {
          fragments.add(trimmed);
        }
      }
    }
  }
  return [...fragments];
}

export function expectNoEnglish(outputs: string[]) {
  const fragments = englishSentenceFragments();
  const leaks = outputs.flatMap((output) => fragments.filter((fragment) => output.includes(fragment)).map((fragment) => `${fragment} ← ${output}`));
  expect(leaks).toEqual([]);
}

export function layoutTexts(node: OverlayLayoutNode | null | undefined, into: string[] = []): string[] {
  if (!node) {
    return into;
  }
  const children = node.props?.children;
  if (typeof children === "string") {
    into.push(children);
  } else if (Array.isArray(children)) {
    for (const child of children) {
      layoutTexts(child as OverlayLayoutNode, into);
    }
  } else if (children && typeof children === "object") {
    layoutTexts(children as OverlayLayoutNode, into);
  }
  return into;
}

