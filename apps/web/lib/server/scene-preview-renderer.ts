// The web app's half of the overlay renderer.
//
// Holds the two things a route handler must not hold itself: the loaded fonts, which are read from
// disk once and reused, and the promise chain that keeps renders from overlapping. Route modules
// may only export route handlers, so the concurrency gate — and the counter that proves it works —
// live here.

import {
  loadSceneRendererFonts,
  prepareSceneLayout,
  renderPreparedSceneSvg,
  type SceneRenderFont
} from "@stream247/overlay-render";
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
//
// Only the drawing waits in that line (M127). The remote pictures of a frame are fetched before it
// joins: a fetch is network time, not CPU, and a picture whose host never answers held every other
// user's preview behind it for the whole fetch deadline when it waited inside.
let renderQueue: Promise<unknown> = Promise.resolve();
let activeRenders = 0;
let peakRenders = 0;

/** Test seam: the highest number of renders ever in flight together. Must never exceed one. */
export function peakConcurrentScenePreviewRenders(): number {
  return peakRenders;
}

// How many previews may hold fetched pictures at once, and how many of those may be one user's (M127).
//
// A prepared frame keeps every picture it fetched in memory as a data: URI until it is drawn, up to
// 64 layers of 4 MiB each. With the fetch inside the drawing slot only one such frame existed at a
// time; without a bound here a single signed-in user could hold as many as they could send. One slot
// per user keeps a user whose picture host never answers from taking the other slot as well, so
// everyone else still gets frames. A request waiting for a slot holds only its parsed scene.
const PREVIEW_SLOTS = 2;
const PREVIEW_SLOTS_PER_USER = 1;

type SlotWaiter = { userId: string; grant: () => void };

let slotsInUse = 0;
const userSlots = new Map<string, number>();
const slotWaiters: SlotWaiter[] = [];

/** Thrown when the request that asked for a preview went away before its turn came. */
export class ScenePreviewAbortedError extends Error {
  constructor() {
    super("The preview request was abandoned before it was drawn.");
    this.name = "ScenePreviewAbortedError";
  }
}

function slotFree(userId: string): boolean {
  return slotsInUse < PREVIEW_SLOTS && (userSlots.get(userId) ?? 0) < PREVIEW_SLOTS_PER_USER;
}

function takeSlot(userId: string): void {
  slotsInUse += 1;
  userSlots.set(userId, (userSlots.get(userId) ?? 0) + 1);
}

function releaseSlot(userId: string): void {
  slotsInUse -= 1;
  const held = (userSlots.get(userId) ?? 1) - 1;
  if (held > 0) {
    userSlots.set(userId, held);
  } else {
    userSlots.delete(userId);
  }

  // First come, first served among the users who may take a slot now.
  for (let index = 0; index < slotWaiters.length && slotsInUse < PREVIEW_SLOTS; ) {
    const waiter = slotWaiters[index];
    if (slotFree(waiter.userId)) {
      slotWaiters.splice(index, 1);
      takeSlot(waiter.userId);
      waiter.grant();
    } else {
      index += 1;
    }
  }
}

function acquireSlot(userId: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new ScenePreviewAbortedError());
  }

  if (slotFree(userId)) {
    takeSlot(userId);
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    // The studio aborts the previous request on every change, so a waiter whose page moved on leaves.
    const onAbort = () => {
      const index = slotWaiters.indexOf(waiter);
      if (index >= 0) {
        slotWaiters.splice(index, 1);
      }
      reject(new ScenePreviewAbortedError());
    };
    const waiter: SlotWaiter = {
      userId,
      grant: () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }
    };
    slotWaiters.push(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Test seam: how many preview requests are waiting for a slot. */
export function waitingScenePreviewRequests(): number {
  return slotWaiters.length;
}

/**
 * Draws one preview frame, waiting its turn.
 *
 * Without embedded glyph outlines: the answer is inlined into a page that already declares the same
 * faces, so shipping the outlines again would multiply the size of every frame for nothing.
 */
export async function renderScenePreviewSvg(
  scene: ScenePreviewRequest,
  requester: { userId?: string; signal?: AbortSignal } = {}
): Promise<string> {
  const userId = requester.userId ?? "";
  await acquireSlot(userId, requester.signal);
  try {
    return await prepareAndDrawPreview(scene);
  } finally {
    releaseSlot(userId);
  }
}

async function prepareAndDrawPreview(scene: ScenePreviewRequest): Promise<string> {
  const [layout, fonts] = await Promise.all([prepareSceneLayout(scene), sceneFonts()]);
  const result = renderQueue.then(async () => {
    activeRenders += 1;
    peakRenders = Math.max(peakRenders, activeRenders);
    try {
      return await renderPreparedSceneSvg(layout, scene, fonts, { embedFont: false });
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
