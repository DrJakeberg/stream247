import type { OverlaySettingsRecord } from "@/lib/server/state";

export type OverlayPublishReviewSection = {
  title: string;
  items: string[];
};

function stringifyList(values: string[]) {
  return values.join(", ");
}

function pushChange(items: string[], label: string, before: string | number | boolean, after: string | number | boolean) {
  if (before === after) {
    return;
  }

  items.push(`${label}: ${String(before)} -> ${String(after)}`);
}

function buildScalarSection(live: OverlaySettingsRecord, draft: OverlaySettingsRecord): OverlayPublishReviewSection | null {
  const items: string[] = [];

  pushChange(items, "Overlay output", live.enabled ? "enabled" : "disabled", draft.enabled ? "enabled" : "disabled");
  pushChange(items, "Channel name", live.channelName, draft.channelName);
  pushChange(items, "Headline", live.headline, draft.headline);
  pushChange(items, "Insert headline", live.insertHeadline, draft.insertHeadline);
  pushChange(items, "Standby headline", live.standbyHeadline, draft.standbyHeadline);
  pushChange(items, "Reconnect headline", live.reconnectHeadline, draft.reconnectHeadline);
  pushChange(items, "Replay label", live.replayLabel, draft.replayLabel);
  pushChange(items, "Brand badge", live.brandBadge || "none", draft.brandBadge || "none");
  pushChange(items, "Accent color", live.accentColor, draft.accentColor);

  return items.length > 0 ? { title: "Scene copy", items } : null;
}

function buildPresetSection(live: OverlaySettingsRecord, draft: OverlaySettingsRecord): OverlayPublishReviewSection | null {
  const items: string[] = [];

  pushChange(items, "Active preset", live.scenePreset, draft.scenePreset);
  pushChange(items, "Insert preset", live.insertScenePreset, draft.insertScenePreset);
  pushChange(items, "Standby preset", live.standbyScenePreset, draft.standbyScenePreset);
  pushChange(items, "Reconnect preset", live.reconnectScenePreset, draft.reconnectScenePreset);
  pushChange(items, "Surface style", live.surfaceStyle, draft.surfaceStyle);
  pushChange(items, "Panel anchor", live.panelAnchor, draft.panelAnchor);
  pushChange(items, "Title scale", live.titleScale, draft.titleScale);
  pushChange(items, "Typography preset", live.typographyPreset, draft.typographyPreset);

  return items.length > 0 ? { title: "Scene presentation", items } : null;
}

function buildVisibilitySection(live: OverlaySettingsRecord, draft: OverlaySettingsRecord): OverlayPublishReviewSection | null {
  const items: string[] = [];

  pushChange(items, "Clock", live.showClock ? "shown" : "hidden", draft.showClock ? "shown" : "hidden");
  pushChange(items, "Next item", live.showNextItem ? "shown" : "hidden", draft.showNextItem ? "shown" : "hidden");
  pushChange(
    items,
    "Schedule teaser",
    live.showScheduleTeaser ? "shown" : "hidden",
    draft.showScheduleTeaser ? "shown" : "hidden"
  );
  pushChange(
    items,
    "Current category",
    live.showCurrentCategory ? "shown" : "hidden",
    draft.showCurrentCategory ? "shown" : "hidden"
  );
  pushChange(
    items,
    "Source label",
    live.showSourceLabel ? "shown" : "hidden",
    draft.showSourceLabel ? "shown" : "hidden"
  );
  pushChange(
    items,
    "Queue preview",
    live.showQueuePreview ? `shown (${live.queuePreviewCount})` : "hidden",
    draft.showQueuePreview ? `shown (${draft.queuePreviewCount})` : "hidden"
  );
  pushChange(items, "Ticker", live.tickerText || "none", draft.tickerText || "none");
  pushChange(items, "Emergency banner", live.emergencyBanner || "off", draft.emergencyBanner || "off");

  return items.length > 0 ? { title: "Visibility and alerts", items } : null;
}

function buildLayerSection(live: OverlaySettingsRecord, draft: OverlaySettingsRecord): OverlayPublishReviewSection | null {
  const items: string[] = [];

  if (stringifyList(live.layerOrder) !== stringifyList(draft.layerOrder)) {
    items.push(`Layer order: ${stringifyList(live.layerOrder)} -> ${stringifyList(draft.layerOrder)}`);
  }

  if (stringifyList(live.disabledLayers) !== stringifyList(draft.disabledLayers)) {
    items.push(
      `Hidden built-in layers: ${stringifyList(live.disabledLayers) || "none"} -> ${stringifyList(draft.disabledLayers) || "none"}`
    );
  }

  const liveNames = new Map(live.customLayers.map((layer) => [layer.id, layer.name] as const));
  const draftNames = new Map(draft.customLayers.map((layer) => [layer.id, layer.name] as const));

  const added = draft.customLayers.filter((layer) => !liveNames.has(layer.id)).map((layer) => layer.name);
  const removed = live.customLayers.filter((layer) => !draftNames.has(layer.id)).map((layer) => layer.name);

  if (added.length > 0) {
    items.push(`Added custom layers: ${stringifyList(added)}`);
  }

  if (removed.length > 0) {
    items.push(`Removed custom layers: ${stringifyList(removed)}`);
  }

  for (const draftLayer of draft.customLayers) {
    const liveLayer = live.customLayers.find((layer) => layer.id === draftLayer.id);
    if (!liveLayer) {
      continue;
    }

    if (JSON.stringify(liveLayer) !== JSON.stringify(draftLayer)) {
      items.push(`Updated custom layer: ${draftLayer.name}`);
    }
  }

  return items.length > 0 ? { title: "Layer stack", items } : null;
}

export function buildOverlayPublishReviewSections(
  live: OverlaySettingsRecord,
  draft: OverlaySettingsRecord
): OverlayPublishReviewSection[] {
  return [
    buildScalarSection(live, draft),
    buildPresetSection(live, draft),
    buildVisibilitySection(live, draft),
    buildLayerSection(live, draft)
  ].filter((section): section is OverlayPublishReviewSection => section !== null);
}
