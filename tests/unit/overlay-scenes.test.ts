import {
  buildOverlayBrandLine,
  buildOverlaySceneMetadataWidgetContent,
  buildOverlaySceneDefinition,
  buildOverlayScenePayload,
  buildOverlayTextLines,
  buildOverlayTextLinesFromScenePayload,
  describeOverlaySceneFrameSupport,
  normalizeOverlaySceneLayerOrder,
  normalizeOverlaySceneCustomLayers,
  resolveOverlaySceneCustomTextFontStack,
  resolveOverlayHeadlineForQueueKind,
  resolveOverlayScenePresetForQueueKind,
  type OverlaySceneSource
} from "@stream247/core";
import { describe, expect, it } from "vitest";

function createOverlaySource(overrides: Partial<OverlaySceneSource> = {}): OverlaySceneSource {
  return {
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
    tickerText: "Coming up next",
    layerOrder: ["chip", "hero", "next", "queue", "schedule", "clock", "banner", "ticker"],
    disabledLayers: [],
    customLayers: [],
    ...overrides
  };
}

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

  it("keeps the default headline for live bridge mode", () => {
    expect(resolveOverlayHeadlineForQueueKind("Live guest takeover", "live")).toBe("Live guest takeover");
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
        ...createOverlaySource(),
        channelName: "Archive TV",
        replayLabel: "Replay stream",
        brandBadge: "Late Night",
        accentColor: "#0e6d5a"
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

  it("does not emit placeholder array tokens when scene text fields are empty", () => {
    const payload = buildOverlayScenePayload({
      overlay: {
        ...createOverlaySource({
          headline: "[]",
          tickerText: "[]"
        }),
        channelName: "[]",
        replayLabel: "[]",
        brandBadge: "[]",
        accentColor: "#0e6d5a"
      },
      queueKind: "asset",
      target: "browser",
      currentTitle: "[]",
      currentCategory: "[]",
      currentSourceName: "[]",
      nextTitle: "[]",
      nextTimeLabel: "[]",
      queueTitles: ["[]", ""],
      timeZone: "Europe/Berlin"
    });

    expect(buildOverlayTextLinesFromScenePayload(payload).some((line) => line.includes("[]"))).toBe(false);
  });

  it("removes invisible characters from rendered overlay text lines", () => {
    const payload = buildOverlayScenePayload({
      overlay: {
        ...createOverlaySource({
          headline: "Always\u200B on air",
          tickerText: "Coming\u2066 up next\u2069"
        }),
        channelName: "Archive\uFEFF TV",
        replayLabel: "Replay\u200D stream",
        brandBadge: "Late\u200B Night",
        accentColor: "#0e6d5a"
      },
      queueKind: "asset",
      target: "browser",
      currentTitle: "Episode\u200B One",
      currentCategory: "Gam\u2066ing\u2069",
      currentSourceName: "Archive\u200B Playlist",
      nextTitle: "Episode\u200B Two",
      queueTitles: ["Episode\u200B Two"],
      timeZone: "Europe/Berlin"
    });

    expect(buildOverlayTextLinesFromScenePayload(payload)).toEqual([
      "Replay stream · Late Night",
      "Now: Episode One",
      "Next: Episode Two",
      "Gaming · Archive Playlist",
      "Coming up next"
    ]);
  });

  it("uses neutral upcoming copy instead of the old scheduling placeholder", () => {
    const payload = buildOverlayScenePayload({
      overlay: {
        ...createOverlaySource(),
        channelName: "Archive TV",
        replayLabel: "Replay stream",
        brandBadge: "",
        accentColor: "#0e6d5a"
      },
      queueKind: "asset",
      target: "browser",
      currentTitle: "Episode One",
      nextTitle: "Coming up next",
      queueTitles: [],
      timeZone: "Europe/Berlin"
    });
    const lines = buildOverlayTextLinesFromScenePayload(payload);

    expect(lines).toContain("Next: Coming up next");
    expect(lines.join("\n")).not.toContain("Scheduling next item");
  });

  it("builds live bridge scene copy", () => {
    const payload = buildOverlayScenePayload({
      overlay: {
        ...createOverlaySource({
          headline: "Live guest takeover",
          tickerText: "Live now"
        }),
        channelName: "Archive TV",
        replayLabel: "Replay stream",
        brandBadge: "Late Night",
        accentColor: "#0e6d5a"
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
    expect(payload.metaLine).toBe("Live input · Live Bridge · RTMP");
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
      overlay: createOverlaySource({
        scenePreset: "replay-lower-third",
        insertScenePreset: "minimal-chip",
        insertHeadline: "Manual bumper",
        standbyHeadline: "Stand by",
        surfaceStyle: "signal",
        panelAnchor: "center",
        titleScale: "cinematic",
        showScheduleTeaser: false,
        showQueuePreview: true,
        queuePreviewCount: 3,
        tickerText: "Always on air",
        layerOrder: ["hero", "chip", "next", "ticker", "clock", "queue", "schedule", "banner"],
        disabledLayers: ["next"]
      }),
      queueKind: "insert"
    });

    expect(scene.resolvedPresetId).toBe("minimal-chip");
    expect(scene.layers[0]?.kind).toBe("hero");
    expect(scene.layers.find((layer) => layer.kind === "ticker")?.enabled).toBe(true);
    expect(scene.layers.find((layer) => layer.kind === "next")?.enabled).toBe(false);
    expect(scene.layers.find((layer) => layer.kind === "schedule")?.enabled).toBe(false);
  });

  it("normalizes typography presets and sanitizes positioned layer URLs", () => {
    const scene = buildOverlaySceneDefinition({
      overlay: createOverlaySource({
        typographyPreset: "editorial-serif",
        customLayers: [
          {
            id: "hero-note",
            kind: "text",
            name: "Hero Note",
            enabled: true,
            xPercent: 5,
            yPercent: 8,
            widthPercent: 42,
            heightPercent: 18,
            opacityPercent: 92,
            text: "Scene Studio V2",
            secondaryText: "Smarter layers",
            textTone: "headline",
            textAlign: "center",
            useAccent: true,
            fontMode: "custom-local",
            customFontFamily: "Aptos, Segoe UI"
          },
          {
            id: "unsafe-widget",
            kind: "widget",
            name: "Unsafe Widget",
            enabled: true,
            xPercent: 58,
            yPercent: 12,
            widthPercent: 30,
            heightPercent: 22,
            opacityPercent: 100,
            url: "javascript:alert(1)",
            title: "Unsafe widget",
            widgetMode: "embed",
            widgetDataKey: "current"
          }
        ]
      }),
      queueKind: "asset"
    });

    expect(scene.typographyPreset).toBe("editorial-serif");
    expect(scene.customLayers).toEqual([
      expect.objectContaining({
        id: "hero-note",
        kind: "text",
        text: "Scene Studio V2",
        secondaryText: "Smarter layers",
        textAlign: "center",
        useAccent: true,
        fontMode: "custom-local",
        customFontFamily: "Aptos, Segoe UI"
      }),
      expect.objectContaining({
        id: "unsafe-widget",
        kind: "widget",
        url: "",
        title: "Unsafe widget",
        widgetMode: "embed",
        widgetDataKey: "current"
      })
    ]);
  });

  it("normalizes metadata widgets and strips unsafe custom font stacks", () => {
    const [widget, text] = normalizeOverlaySceneCustomLayers([
      {
        id: "next-card",
        kind: "widget",
        name: "Next Card",
        enabled: true,
        xPercent: 58,
        yPercent: 12,
        widthPercent: 28,
        heightPercent: 24,
        opacityPercent: 100,
        widgetMode: "metadata",
        widgetDataKey: "next",
        title: "Up Next"
      },
      {
        id: "font-test",
        kind: "text",
        name: "Font Test",
        enabled: true,
        xPercent: 5,
        yPercent: 8,
        widthPercent: 42,
        heightPercent: 18,
        opacityPercent: 92,
        text: "Scene Studio V2",
        secondaryText: "",
        textTone: "headline",
        textAlign: "left",
        useAccent: false,
        fontMode: "custom-local",
        customFontFamily: "url(https://bad.example/font.woff2)"
      }
    ]);

    expect(widget).toEqual(
      expect.objectContaining({
        kind: "widget",
        widgetMode: "metadata",
        widgetDataKey: "next",
        title: "Up Next"
      })
    );
    expect(text).toEqual(
      expect.objectContaining({
        kind: "text",
        fontMode: "custom-local",
        customFontFamily: ""
      })
    );
  });

  it("keeps metadata widget titles empty so canonical labels can fall back", () => {
    const [widget] = normalizeOverlaySceneCustomLayers([
      {
        id: "current-card",
        kind: "widget",
        name: "Current Card",
        enabled: true,
        xPercent: 58,
        yPercent: 12,
        widthPercent: 28,
        heightPercent: 24,
        opacityPercent: 100,
        widgetMode: "metadata",
        widgetDataKey: "current",
        title: ""
      }
    ]);

    expect(widget).toEqual(
      expect.objectContaining({
        kind: "widget",
        widgetMode: "metadata",
        widgetDataKey: "current",
        title: ""
      })
    );
  });
});

describe("overlay scene frame support", () => {
  it("treats local paths as supported, dedicated embed endpoints as limited, and page URLs conservatively", () => {
    expect(describeOverlaySceneFrameSupport("/overlay/widget")).toEqual(
      expect.objectContaining({
        status: "supported",
        badgeLabel: "Self-hosted"
      })
    );

    expect(describeOverlaySceneFrameSupport("https://www.youtube.com/embed/test")).toEqual(
      expect.objectContaining({
        status: "limited",
        providerLabel: "YouTube"
      })
    );

    expect(describeOverlaySceneFrameSupport("https://www.youtube.com/watch?v=test")).toEqual(
      expect.objectContaining({
        status: "unsupported",
        providerLabel: "YouTube"
      })
    );

    expect(describeOverlaySceneFrameSupport("https://player.twitch.tv/?channel=test&parent=stream247.example.com")).toEqual(
      expect.objectContaining({
        status: "limited",
        providerLabel: "Twitch"
      })
    );

    expect(describeOverlaySceneFrameSupport("https://www.twitch.tv/testchannel")).toEqual(
      expect.objectContaining({
        status: "unsupported",
        providerLabel: "Twitch"
      })
    );

    expect(describeOverlaySceneFrameSupport("https://widgets.example.com/frame")).toEqual(
      expect.objectContaining({
        status: "limited",
        badgeLabel: "Limited"
      })
    );
  });

  it("applies remote provider rules to protocol-relative frame URLs", () => {
    expect(describeOverlaySceneFrameSupport("//www.youtube.com/watch?v=test")).toEqual(
      expect.objectContaining({
        status: "unsupported",
        providerLabel: "YouTube"
      })
    );

    expect(describeOverlaySceneFrameSupport("//www.youtube.com/embed/test")).toEqual(
      expect.objectContaining({
        status: "limited",
        providerLabel: "YouTube"
      })
    );

    expect(describeOverlaySceneFrameSupport("//player.twitch.tv/?channel=test&parent=stream247.example.com")).toEqual(
      expect.objectContaining({
        status: "limited",
        providerLabel: "Twitch"
      })
    );

    expect(describeOverlaySceneFrameSupport("//widgets.example.com/frame")).toEqual(
      expect.objectContaining({
        status: "limited",
        badgeLabel: "Limited"
      })
    );
  });
});

describe("overlay scene typography helpers", () => {
  it("resolves custom local stacks with preset fallbacks", () => {
    expect(
      resolveOverlaySceneCustomTextFontStack({
        fontMode: "custom-local",
        customFontFamily: "Aptos, Segoe UI",
        typographyPreset: "editorial-serif"
      })
    ).toContain("Aptos, Segoe UI");

    expect(
      resolveOverlaySceneCustomTextFontStack({
        fontMode: "preset",
        customFontFamily: "Ignored",
        typographyPreset: "studio-sans"
      })
    ).toBeNull();
  });
});

describe("overlay metadata widgets", () => {
  it("builds queue-aware metadata widget copy from the canonical scene payload", () => {
    const payload = buildOverlayScenePayload({
      overlay: {
        ...createOverlaySource(),
        channelName: "Archive TV",
        replayLabel: "Replay stream",
        brandBadge: "Late Night",
        accentColor: "#0e6d5a"
      },
      queueKind: "asset",
      target: "browser",
      currentTitle: "Episode One",
      currentCategory: "Gaming",
      currentSourceName: "Archive Playlist",
      nextTitle: "Episode Two",
      nextTimeLabel: "10:00 to 12:00",
      queueTitles: ["Episode Two", "Episode Three", "Episode Four"],
      timeZone: "Europe/Berlin"
    });

    expect(
      buildOverlaySceneMetadataWidgetContent({
        payload,
        widgetDataKey: "queue"
      })
    ).toEqual({
      label: "Later",
      title: "Episode Two",
      body: "Episode Three",
      secondary: "Episode Two · Episode Three"
    });
  });

  it("falls back to canonical labels when no override is set", () => {
    const payload = buildOverlayScenePayload({
      overlay: {
        ...createOverlaySource(),
        channelName: "Archive TV",
        replayLabel: "Replay stream",
        brandBadge: "Late Night",
        accentColor: "#0e6d5a"
      },
      queueKind: "asset",
      target: "browser",
      currentTitle: "Episode One",
      nextTitle: "Episode Two",
      nextTimeLabel: "10:00 to 12:00",
      queueTitles: ["Episode Two", "Episode Three", "Episode Four"],
      timeZone: "Europe/Berlin"
    });

    expect(
      buildOverlaySceneMetadataWidgetContent({
        payload,
        widgetDataKey: "current",
        labelOverride: ""
      }).label
    ).toBe("Now Playing");

    expect(
      buildOverlaySceneMetadataWidgetContent({
        payload,
        widgetDataKey: "next",
        labelOverride: ""
      }).label
    ).toBe("Next");

    expect(
      buildOverlaySceneMetadataWidgetContent({
        payload,
        widgetDataKey: "queue",
        labelOverride: ""
      }).label
    ).toBe("Later");
  });
});
