import { OVERLAY_PANEL_IDS, resolvePlacementPixelBox } from "@stream247/core";
import { intersectDesignBoxes, type DesignBox } from "@/lib/overlay-placement-drag";
import { overlayPanelLabel } from "@/lib/overlay-panel-labels";
import type { OverlaySettingsRecord } from "@/lib/server/state";

/** The design grid: at this size design pixels and frame pixels are the same number. */
const DESIGN_FRAME = { width: 1920, height: 1080 };

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

  // Moving one of the renderer's own panels changes the broadcast picture as much as adding a
  // layer does, so it belongs in the review rather than only in the diff nobody reads.
  for (const id of OVERLAY_PANEL_IDS) {
    const before = live.panelPlacements[id];
    const after = draft.panelPlacements[id];
    if (!before && after) {
      items.push(`Placed panel: ${id}`);
    } else if (before && !after) {
      items.push(`Returned panel to the layout: ${id}`);
    } else if (before && after && JSON.stringify(before) !== JSON.stringify(after)) {
      items.push(`Moved panel: ${id}`);
    }
  }

  return items.length > 0 ? { title: "Layer stack", items } : null;
}

/**
 * Which boxes on the draft share a rectangle, and which one.
 *
 * Overlap is named, not forbidden — the operator's decision, and the right one: a logo is supposed
 * to be able to sit on a panel, and a channel whose studio refused could not be laid out at all.
 * What must not happen is a collision nobody noticed going out live, so the review says the two
 * names and the rectangle and leaves the judgement where it belongs.
 *
 * Measured on the 1920x1080 design grid rather than the profile's output size: the review is read
 * next to the sidebar's captions, which are in design pixels, and a review whose numbers changed
 * when somebody switched the encoder to 720p would be telling the operator about the encoder.
 */
function buildOverlapSection(draft: OverlaySettingsRecord): OverlayPublishReviewSection | null {
  const boxes: Array<{ label: string; box: DesignBox }> = [];

  for (const id of OVERLAY_PANEL_IDS) {
    const placement = draft.panelPlacements[id];
    if (placement) {
      boxes.push({ label: overlayPanelLabel(id), box: resolvePlacementPixelBox(placement, DESIGN_FRAME) });
    }
  }

  // A layer that is switched off draws nothing, so it collides with nothing. Embed and widget
  // layers are left in: satori does not draw them, but the browser overlay does, and this review
  // is about the scene rather than about one of the two things that render it.
  for (const layer of draft.customLayers) {
    if (layer.enabled) {
      boxes.push({ label: layer.name, box: resolvePlacementPixelBox(layer, DESIGN_FRAME) });
    }
  }

  const items: string[] = [];
  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      const left = boxes[first]!;
      const right = boxes[second]!;
      const shared = intersectDesignBoxes(left.box, right.box);
      if (shared) {
        items.push(
          `${left.label} and ${right.label} overlap at ` +
            `x ${String(Math.round(shared.left))} · y ${String(Math.round(shared.top))} · ` +
            `${String(Math.round(shared.width))} × ${String(Math.round(shared.height))}`
        );
      }
    }
  }

  return items.length > 0 ? { title: "Overlapping panels", items } : null;
}

export function buildOverlayPublishReviewSections(
  live: OverlaySettingsRecord,
  draft: OverlaySettingsRecord
): OverlayPublishReviewSection[] {
  const changes = [
    buildScalarSection(live, draft),
    buildPresetSection(live, draft),
    buildVisibilitySection(live, draft),
    buildLayerSection(live, draft)
  ].filter((section): section is OverlayPublishReviewSection => section !== null);

  // Overlap is a property of the draft, not a difference from live, so it is only worth saying
  // when there is a publish to say it about. Emitting it on an unchanged draft would make an
  // empty review look like a pending change, and the dialog reads exactly that emptiness to decide
  // whether there is anything to publish.
  if (changes.length === 0) {
    return changes;
  }

  const overlaps = buildOverlapSection(draft);
  return overlaps ? [...changes, overlaps] : changes;
}
