import {
  buildOverlayBrandLine,
  buildOverlaySceneDefinition,
  buildOverlayTextLines,
  normalizeOverlaySceneLayerOrder,
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

  it("switches reconnects to the reconnect scene", () => {
    expect(resolveOverlayScenePresetForQueueKind("minimal-chip", "reconnect")).toBe("reconnect-board");
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
        surfaceStyle: "signal",
        panelAnchor: "center",
        titleScale: "cinematic",
        showClock: true,
        showNextItem: true,
        showScheduleTeaser: false,
        showQueuePreview: true,
        emergencyBanner: "",
        tickerText: "Always on air",
        layerOrder: ["hero", "chip", "next", "ticker", "clock", "queue", "schedule", "banner"]
      },
      queueKind: "insert"
    });

    expect(scene.resolvedPresetId).toBe("bumper-board");
    expect(scene.layers[0]?.kind).toBe("hero");
    expect(scene.layers.find((layer) => layer.kind === "ticker")?.enabled).toBe(true);
    expect(scene.layers.find((layer) => layer.kind === "schedule")?.enabled).toBe(false);
  });
});
