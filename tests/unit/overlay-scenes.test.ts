import {
  buildOverlayBrandLine,
  buildOverlaySceneDefinition,
  buildOverlayScenePayload,
  buildOverlayTextLines,
  buildOverlayTextLinesFromScenePayload,
  normalizeOverlaySceneLayerOrder,
  resolveOverlayHeadlineForQueueKind,
  resolveOverlayScenePresetForQueueKind
} from "@stream247/core";
import { describe, expect, it } from "vitest";

describe("overlay scene resolution", () => {
  it("keeps the configured scene for regular assets", () => {
    expect(resolveOverlayScenePresetForQueueKind("split-now-next", "asset")).toBe("split-now-next");
  });

  it("switches inserts to the bumper scene", () => {
    expect(resolveOverlayScenePresetForQueueKind("replay-lower-third", "insert")).toBe("bumper-board");
  });

  it("uses configured per-mode scene presets when provided", () => {
    expect(
      resolveOverlayScenePresetForQueueKind("replay-lower-third", "insert", {
        insertScenePreset: "minimal-chip",
        standbyScenePreset: "split-now-next",
        reconnectScenePreset: "standby-board"
      })
    ).toBe("minimal-chip");
    expect(
      resolveOverlayScenePresetForQueueKind("replay-lower-third", "standby", {
        standbyScenePreset: "split-now-next"
      })
    ).toBe("split-now-next");
  });

  it("switches reconnects to the reconnect scene", () => {
    expect(resolveOverlayScenePresetForQueueKind("minimal-chip", "reconnect")).toBe("reconnect-board");
  });
});

describe("overlay headline resolution", () => {
  it("keeps the asset headline for regular assets", () => {
    expect(resolveOverlayHeadlineForQueueKind("Always on air", "asset")).toBe("Always on air");
  });

  it("uses configured mode headlines when provided", () => {
    expect(
      resolveOverlayHeadlineForQueueKind("Always on air", "insert", {
        insertHeadline: "Manual bumper"
      })
    ).toBe("Manual bumper");
    expect(
      resolveOverlayHeadlineForQueueKind("Always on air", "reconnect", {
        reconnectHeadline: "Refreshing the output"
      })
    ).toBe("Refreshing the output");
  });
});

describe("overlay text lines", () => {
  it("builds a combined brand line", () => {
    expect(buildOverlayBrandLine("Replay stream", "Archive Channel")).toBe("Replay stream · Archive Channel");
  });

  it("builds insert copy for the bumper scene", () => {
    expect(
      buildOverlayTextLines({
        scenePreset: "bumper-board",
        replayLabel: "Replay stream",
        brandBadge: "Archive Channel",
        headline: "Insert on air",
        nowTitle: "Channel ID",
        nextTitle: "Main program returns",
        queueTitles: ["Main program returns", "Later item"],
        tickerText: "Coming up all night",
        showQueuePreview: true
      })
    ).toEqual([
      "Replay stream · Archive Channel",
      "Insert on air",
      "Insert: Channel ID",
      "Next: Main program returns",
      "After this: Main program returns · Later item",
      "Coming up all night"
    ]);
  });

  it("builds reconnect copy for the reconnect scene", () => {
    expect(
      buildOverlayTextLines({
        scenePreset: "reconnect-board",
        replayLabel: "Replay stream",
        headline: "Scheduled reconnect in progress",
        nowTitle: "Ignored",
        nextTitle: "Archive Hour",
        queueTitles: ["Archive Hour"],
        showQueuePreview: true
      })
    ).toEqual([
      "Replay stream",
      "Scheduled reconnect in progress",
      "Resuming with: Archive Hour",
      "Queue: Archive Hour"
    ]);
  });

  it("builds a canonical scene payload and renders text from it", () => {
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
        showClock: true,
        showNextItem: true,
        showScheduleTeaser: true,
        showCurrentCategory: true,
        showSourceLabel: true,
        showQueuePreview: true,
        queuePreviewCount: 2,
        emergencyBanner: "",
        tickerText: "Coming up next",
        layerOrder: ["chip", "hero", "next", "queue", "schedule", "clock", "banner", "ticker"],
        disabledLayers: []
      },
      queueKind: "asset",
      target: "browser",
      currentTitle: "Episode One",
      currentCategory: "Gaming",
      currentSourceName: "Archive Playlist",
      nextTitle: "Episode Two",
      nextTimeLabel: "10:00 to 12:00",
      queueTitles: ["Episode Two", "Episode Three"],
      timeZone: "Europe/Berlin"
    });

    expect(payload.scene.resolvedPresetId).toBe("split-now-next");
    expect(payload.heroLabel).toBe("Now Playing");
    expect(payload.metaLine).toBe("Gaming · Archive Playlist");
    expect(payload.queueTitles).toEqual(["Episode Two", "Episode Three"]);
    expect(buildOverlayTextLinesFromScenePayload(payload)).toEqual([
      "Replay stream · Late Night",
      "Now: Episode One",
      "Next: Episode Two",
      "Gaming · Archive Playlist",
      "Coming up next"
    ]);
  });
});

describe("overlay scene definitions", () => {
  it("normalizes custom layer order and preserves valid entries first", () => {
    expect(normalizeOverlaySceneLayerOrder(["hero", "chip", "clock"])).toEqual([
      "hero",
      "chip",
      "clock",
      "next",
      "queue",
      "schedule",
      "banner",
      "ticker"
    ]);
  });

  it("builds a scene definition with resolved preset and enabled layers", () => {
    const scene = buildOverlaySceneDefinition({
      overlay: {
        scenePreset: "replay-lower-third",
        insertScenePreset: "minimal-chip",
        standbyScenePreset: "standby-board",
        reconnectScenePreset: "reconnect-board",
        headline: "Always on air",
        insertHeadline: "Manual bumper",
        standbyHeadline: "Stand by",
        reconnectHeadline: "Refreshing output",
        surfaceStyle: "signal",
        panelAnchor: "center",
        titleScale: "cinematic",
        showClock: true,
        showNextItem: true,
        showScheduleTeaser: false,
        showCurrentCategory: true,
        showSourceLabel: true,
        showQueuePreview: true,
        queuePreviewCount: 3,
        emergencyBanner: "",
        tickerText: "Always on air",
        layerOrder: ["hero", "chip", "next", "ticker", "clock", "queue", "schedule", "banner"],
        disabledLayers: ["next"]
      },
      queueKind: "insert"
    });

    expect(scene.resolvedPresetId).toBe("minimal-chip");
    expect(scene.layers[0]?.kind).toBe("hero");
    expect(scene.layers.find((layer) => layer.kind === "ticker")?.enabled).toBe(true);
    expect(scene.layers.find((layer) => layer.kind === "next")?.enabled).toBe(false);
    expect(scene.layers.find((layer) => layer.kind === "schedule")?.enabled).toBe(false);
  });
});
