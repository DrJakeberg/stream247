import { describe, expect, it } from "vitest";
import type { OverlaySettingsRecord } from "../../apps/web/lib/server/state";
import { buildOverlayPublishReviewSections } from "../../apps/web/lib/overlay-publish-review";

function buildOverlay(overrides: Partial<OverlaySettingsRecord> = {}): OverlaySettingsRecord {
  return {
    enabled: true,
    channelName: "Stream247",
    headline: "Always on air",
    insertHeadline: "Insert on air",
    standbyHeadline: "Please wait, restream is starting",
    reconnectHeadline: "Scheduled reconnect in progress",
    replayLabel: "Replay stream",
    brandBadge: "",
    scenePreset: "replay-lower-third",
    insertScenePreset: "bumper-board",
    standbyScenePreset: "standby-board",
    reconnectScenePreset: "reconnect-board",
    accentColor: "#0e6d5a",
    surfaceStyle: "glass",
    panelAnchor: "bottom",
    titleScale: "balanced",
    typographyPreset: "studio-sans",
    showClock: true,
    showNextItem: true,
    showScheduleTeaser: true,
    showCurrentCategory: true,
    showSourceLabel: true,
    showQueuePreview: false,
    queuePreviewCount: 3,
    layerOrder: ["chip", "hero", "next", "queue", "schedule", "clock", "banner", "ticker"],
    disabledLayers: [],
    customLayers: [],
    emergencyBanner: "",
    tickerText: "",
    updatedAt: "2026-04-22T10:00:00.000Z",
    ...overrides
  };
}

describe("overlay publish review", () => {
  it("returns no sections when live and draft match", () => {
    const overlay = buildOverlay();
    expect(buildOverlayPublishReviewSections(overlay, overlay)).toEqual([]);
  });

  it("summarizes changed copy, emergency banner, and custom layers", () => {
    const live = buildOverlay({
      customLayers: [
        {
          id: "logo-live",
          kind: "logo",
          name: "Logo Layer",
          enabled: true,
          xPercent: 70,
          yPercent: 8,
          widthPercent: 18,
          heightPercent: 12,
          opacityPercent: 100,
          allowOutsideSafeArea: false,
          url: "/brand.svg",
          altText: "Brand",
          fit: "contain"
        }
      ]
    });
    const draft = buildOverlay({
      headline: "Prime Time Replay",
      emergencyBanner: "Breaking update",
      customLayers: [
        {
          id: "logo-live",
          kind: "logo",
          name: "Logo Layer",
          enabled: true,
          xPercent: 76,
          yPercent: 4,
          widthPercent: 20,
          heightPercent: 12,
          opacityPercent: 100,
          allowOutsideSafeArea: true,
          url: "/brand.svg",
          altText: "Brand",
          fit: "contain"
        },
        {
          id: "text-new",
          kind: "text",
          name: "Breaking strap",
          enabled: true,
          xPercent: 4,
          yPercent: 72,
          widthPercent: 88,
          heightPercent: 12,
          opacityPercent: 100,
          allowOutsideSafeArea: false,
          text: "Breaking update",
          secondaryText: "",
          textTone: "headline",
          textAlign: "left",
          useAccent: true,
          fontMode: "preset",
          customFontFamily: ""
        }
      ]
    });

    expect(buildOverlayPublishReviewSections(live, draft)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Scene copy",
          items: expect.arrayContaining(["Headline: Always on air -> Prime Time Replay"])
        }),
        expect.objectContaining({
          title: "Visibility and alerts",
          items: expect.arrayContaining(["Emergency banner: off -> Breaking update"])
        }),
        expect.objectContaining({
          title: "Layer stack",
          items: expect.arrayContaining(["Added custom layers: Breaking strap", "Updated custom layer: Logo Layer"])
        })
      ])
    );
  });
});
