// The web app's half of the overlay renderer.
//
// Holds the two things a route handler must not hold itself: the loaded fonts, which are read from
// disk once and reused, and the promise chain that keeps renders from overlapping. Route modules
// may only export route handlers, so the concurrency gate — and the counter that proves it works —
// live here.

import { loadSceneRendererFonts, renderSceneSvg, type SceneRenderFont } from "@stream247/overlay-render";
import type { ScenePreviewRequest } from "@/lib/scene-preview-request";

let fontsPromise: Promise<SceneRenderFont[]> | null = null;

function sceneFonts(): Promise<SceneRenderFont[]> {
  if (!fontsPromise) {
    fontsPromise = loadSceneRendererFonts(process.env).catch((error: unknown) => {
      // Not cached as a rejection: installing the font should fix the studio without a restart.
      fontsPromise = null;
      throw error;
    });
  }

  return fontsPromise;
}

// Renders run one at a time, always.
//
// This box encodes a 24/7 channel while it serves the studio, and the scene editor asks for a frame
// every time the operator changes something. Six concurrent renders would be six cores taken away
// from the encoder for as long as they run. A queue costs the operator a few milliseconds of
// latency; it costs the channel nothing.
let renderQueue: Promise<unknown> = Promise.resolve();
let activeRenders = 0;
let peakRenders = 0;

/** Test seam: the highest number of renders ever in flight together. Must never exceed one. */
export function peakConcurrentScenePreviewRenders(): number {
  return peakRenders;
}

/**
 * Draws one preview frame, waiting its turn.
 *
 * Without embedded glyph outlines: the answer is inlined into a page that already declares the same
 * faces, so shipping the outlines again would multiply the size of every frame for nothing.
 */
export async function renderScenePreviewSvg(scene: ScenePreviewRequest): Promise<string> {
  const result = renderQueue.then(async () => {
    activeRenders += 1;
    peakRenders = Math.max(peakRenders, activeRenders);
    try {
      return await renderSceneSvg(scene, await sceneFonts(), { embedFont: false });
    } finally {
      activeRenders -= 1;
    }
  });

  // The chain must survive a failed render, or one bad body would wedge every later preview.
  renderQueue = result.catch(() => undefined);
  return result;
}

/**
 * A scene compiled into this file, drawn to prove the renderer can draw.
 *
 * Nothing here comes from the workspace, so the answer says only whether this process can lay out a
 * frame — which is a property of the build, not of anybody's data.
 */
const SELF_TEST_SCENE: ScenePreviewRequest = {
  width: 640,
  height: 360,
  payload: {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third",
      customLayers: []
    },
    channelName: "Renderer self-check",
    accentColor: "#6ee7ff",
    brandLine: "STREAM247",
    heroLabel: "Self check",
    heroTitle: "Renderer self-check",
    heroBody: "",
    metaLine: "",
    nextLabel: "",
    nextTitle: "",
    nextTimeLabel: "",
    queueTitles: [],
    tickerText: "",
    emergencyBanner: "",
    timeZone: "UTC"
  }
};

let selfTestResult: { renderer: "ok"; width: number; height: number; bytes: number } | null = null;
let selfTestRenders = 0;
let selfTestInFlight: Promise<{ renderer: "ok"; width: number; height: number; bytes: number }> | null = null;

/** Test seam: how many times the self-check has actually drawn something. */
export function scenePreviewSelfTestRenderCount(): number {
  return selfTestRenders;
}

/**
 * Renders the built-in scene once and remembers that it worked.
 *
 * This exists because satori builds its layout engine on the first render rather than when it is
 * imported — measured, not assumed. A route that loads therefore proves nothing about a route that
 * can draw, and the failure this endpoint risks most (a production bundle that did not carry the
 * engine's payload along) would otherwise surface on an operator's first preview instead of in any
 * check that runs before a deployment.
 *
 * The result is cached on success and concurrent callers share one attempt, so this can be probed
 * as often as anyone likes and still costs exactly one render per process.
 */
export async function checkScenePreviewRenderer() {
  if (selfTestResult) {
    return selfTestResult;
  }

  if (!selfTestInFlight) {
    selfTestInFlight = (async () => {
      selfTestRenders += 1;
      const svg = await renderScenePreviewSvg(SELF_TEST_SCENE);
      selfTestResult = {
        renderer: "ok",
        width: SELF_TEST_SCENE.width,
        height: SELF_TEST_SCENE.height,
        bytes: Buffer.byteLength(svg)
      };
      return selfTestResult;
    })().finally(() => {
      // Only a success is remembered. Installing the missing font should fix the check without a
      // restart, and a failing renderer fails fast rather than looping.
      selfTestInFlight = null;
    });
  }

  return selfTestInFlight;
}
