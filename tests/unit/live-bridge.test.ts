import { describe, expect, it } from "vitest";
import {
  buildOverlayScenePayload,
  isValidLiveBridgeInputUrl,
  normalizeLiveBridgeInputType,
  summarizeLiveBridgeInput
} from "@stream247/core";

describe("live bridge helpers", () => {
  it("normalizes input types", () => {
    expect(normalizeLiveBridgeInputType("hls")).toBe("hls");
    expect(normalizeLiveBridgeInputType("rtmp")).toBe("rtmp");
    expect(normalizeLiveBridgeInputType("unexpected")).toBe("rtmp");
  });

  it("validates RTMP and HLS bridge URLs", () => {
    expect(isValidLiveBridgeInputUrl("rtmp://encoder.example.com/live/key", "rtmp")).toBe(true);
    expect(isValidLiveBridgeInputUrl("rtmps://encoder.example.com/live/key", "rtmp")).toBe(true);
    expect(isValidLiveBridgeInputUrl("https://example.com/master.m3u8", "hls")).toBe(true);
    expect(isValidLiveBridgeInputUrl("ftp://example.com/live", "hls")).toBe(false);
    expect(isValidLiveBridgeInputUrl("https://example.com/master.m3u8", "rtmp")).toBe(false);
  });

  it("summarizes live bridge inputs without exposing path secrets", () => {
    expect(summarizeLiveBridgeInput("rtmp://encoder.example.com/live/secret-key")).toBe("RTMP · encoder.example.com");
    expect(summarizeLiveBridgeInput("https://example.com/live/master.m3u8")).toBe("HTTPS · example.com");
  });

  it("builds a live scene payload", () => {
    const payload = buildOverlayScenePayload({
      overlay: {
        channelName: "Archive TV",
        replayLabel: "Replay stream",
        brandBadge: "Late Night",
        accentColor: "#0e6d5a",
        scenePreset: "split-now-next",
        insertScenePreset: "bumper-board",
        standbyScenePreset: "standby-board",
        reconnectScenePreset: "reconnect-board",
        headline: "Always on air",
        insertHeadline: "Manual insert",
        standbyHeadline: "Please wait",
        reconnectHeadline: "Refreshing output",
        surfaceStyle: "glass",
        panelAnchor: "bottom",
        titleScale: "balanced",
        typographyPreset: "studio-sans",
        showClock: true,
        showNextItem: true,
        showScheduleTeaser: true,
        showCurrentCategory: true,
        showSourceLabel: true,
        showQueuePreview: true,
        queuePreviewCount: 2,
        emergencyBanner: "",
        tickerText: "Live guest takeover",
        layerOrder: ["chip", "hero", "next", "queue", "schedule", "clock", "banner", "ticker"],
        disabledLayers: [],
        customLayers: []
      },
      queueKind: "live",
      target: "browser",
      currentTitle: "Guest Interview",
      currentCategory: "Live input",
      currentSourceName: "Live Bridge · RTMP",
      nextTitle: "Replay Hour",
      nextTimeLabel: "11:00 to 12:00",
      queueTitles: ["Replay Hour", "Late Night Archive"],
      timeZone: "Europe/Berlin"
    });

    expect(payload.heroLabel).toBe("Live Now");
    expect(payload.nextLabel).toBe("After Live");
    expect(payload.metaLine).toContain("Live Bridge");
    expect(payload.queueKind).toBe("live");
  });
});
