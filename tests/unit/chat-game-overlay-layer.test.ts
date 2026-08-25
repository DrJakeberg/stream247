import { describe, expect, it } from "vitest";
import {
  SNAKE_GAME_DEFINITION,
  buildOverlaySceneLayout,
  createDefaultChatGameSettings,
  normalizeOverlaySceneCustomLayers,
  type OverlayGameLayerPlacement,
  type OverlayGameView,
  type OverlayLayoutNode,
  type OverlayScenePayloadView
} from "@stream247/core";

/**
 * The game panel in the native on-air renderer. Two gates decide whether it exists at all — the
 * scene must carry an enabled game layer AND a game must be running — and once it renders it has
 * to stay inside the frame, because this PNG is composited over the broadcast with no second
 * chance to clip it.
 */

const FRAME = { width: 1920, height: 1080 };

function gamePlacement(overrides: Partial<OverlayGameLayerPlacement> = {}): OverlayGameLayerPlacement {
  return {
    kind: "game",
    enabled: true,
    xPercent: 62,
    yPercent: 8,
    widthPercent: 26,
    heightPercent: 40,
    opacityPercent: 100,
    allowOutsideSafeArea: false,
    ...overrides
  };
}

function createPayload(customLayers: OverlayGameLayerPlacement[]): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third",
      customLayers
    },
    channelName: "3JC Retro",
    accentColor: "#6ee7ff",
    brandLine: "STREAM247",
    heroLabel: "Now playing",
    heroTitle: "Advent of Code 2025",
    heroBody: "Recorded live",
    metaLine: "Programming",
    nextLabel: "Up next",
    nextTitle: "Retro Night",
    nextTimeLabel: "21:30",
    queueTitles: [],
    tickerText: "",
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

function gameView(): OverlayGameView {
  const settings = createDefaultChatGameSettings();
  return SNAKE_GAME_DEFINITION.renderModel(SNAKE_GAME_DEFINITION.createInitialState(settings, 3), settings);
}

function collectText(node: OverlayLayoutNode | OverlayLayoutNode[] | string | undefined): string[] {
  if (typeof node === "string") {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }
  if (!node) {
    return [];
  }
  return collectText(node.props.children);
}

function findAbsoluteNodes(node: OverlayLayoutNode): OverlayLayoutNode[] {
  const children = node.props.children;
  const childNodes = Array.isArray(children) ? children : children && typeof children !== "string" ? [children] : [];
  const nested = childNodes.flatMap(findAbsoluteNodes);
  return node.props.style?.position === "absolute" ? [node, ...nested] : nested;
}

describe("the game layer in the native on-air frame", () => {
  it("renders the panel when the scene has an enabled game layer and a game is running", () => {
    const layout = buildOverlaySceneLayout(
      { payload: createPayload([gamePlacement()]), game: gameView() },
      { ...FRAME, now: new Date("2026-08-25T12:00:00Z") }
    );

    const texts = collectText(layout);
    expect(texts.some((value) => value.includes("CHAT PLAYS SNAKE"))).toBe(true);
    expect(texts.some((value) => value.includes("Score 0"))).toBe(true);
  });

  it("draws nothing when the scene has no game layer, however live the game is", () => {
    const layout = buildOverlaySceneLayout(
      { payload: createPayload([]), game: gameView() },
      { ...FRAME, now: new Date("2026-08-25T12:00:00Z") }
    );

    expect(collectText(layout).some((value) => value.toLowerCase().includes("snake"))).toBe(false);
  });

  it("draws nothing when the layer exists but is disabled, so switching the layer off removes the game", () => {
    const layout = buildOverlaySceneLayout(
      { payload: createPayload([gamePlacement({ enabled: false })]), game: gameView() },
      { ...FRAME, now: new Date("2026-08-25T12:00:00Z") }
    );

    expect(collectText(layout).some((value) => value.toLowerCase().includes("snake"))).toBe(false);
  });

  it("draws nothing when no game is running, rather than an empty board", () => {
    const layout = buildOverlaySceneLayout(
      { payload: createPayload([gamePlacement()]), game: null },
      { ...FRAME, now: new Date("2026-08-25T12:00:00Z") }
    );

    expect(collectText(layout).some((value) => value.toLowerCase().includes("snake"))).toBe(false);
  });

  it("keeps the panel inside the frame even for a box drawn against the far edge", () => {
    const layout = buildOverlaySceneLayout(
      {
        payload: createPayload([gamePlacement({ xPercent: 90, yPercent: 90, widthPercent: 80, heightPercent: 80 })]),
        game: gameView()
      },
      { ...FRAME, now: new Date("2026-08-25T12:00:00Z") }
    );

    const [panel] = findAbsoluteNodes(layout);
    expect(panel).toBeDefined();
    const style = panel!.props.style!;
    expect(Number(style.left) + Number(style.width)).toBeLessThanOrEqual(FRAME.width);
    expect(Number(style.left)).toBeGreaterThanOrEqual(0);
    expect(Number(style.top)).toBeGreaterThanOrEqual(0);
  });

  it("respects the safe-area margins unless the layer opted out of them", () => {
    const clamped = buildOverlaySceneLayout(
      { payload: createPayload([gamePlacement({ xPercent: 0, yPercent: 0 })]), game: gameView() },
      { ...FRAME, now: new Date("2026-08-25T12:00:00Z") }
    );
    const free = buildOverlaySceneLayout(
      { payload: createPayload([gamePlacement({ xPercent: 0, yPercent: 0, allowOutsideSafeArea: true })]), game: gameView() },
      { ...FRAME, now: new Date("2026-08-25T12:00:00Z") }
    );

    const [clampedPanel] = findAbsoluteNodes(clamped);
    const [freePanel] = findAbsoluteNodes(free);
    expect(Number(clampedPanel!.props.style!.left)).toBeGreaterThan(0);
    expect(Number(clampedPanel!.props.style!.top)).toBeGreaterThan(0);
    expect(Number(freePanel!.props.style!.left)).toBe(0);
    expect(Number(freePanel!.props.style!.top)).toBe(0);
  });
});

describe("the game layer survives scene normalisation", () => {
  it("round-trips a game layer through normalizeOverlaySceneCustomLayers", () => {
    const layers = normalizeOverlaySceneCustomLayers([
      { id: "game-1", kind: "game", name: "Snake Panel", enabled: true, xPercent: 60, yPercent: 10 }
    ]);

    expect(layers).toHaveLength(1);
    expect(layers[0]!.kind).toBe("game");
    expect(layers[0]!.enabled).toBe(true);
  });
});
