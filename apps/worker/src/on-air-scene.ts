import {
  resolveStreamOutputSettings,
  type StreamOutputSettings
} from "@stream247/core";

export type OnAirOverlayMode = "none" | "text" | "scene";

export const ON_AIR_SCENE_PIPE_FD = 3;

/**
 * Frame rate ffmpeg is told the overlay pipe delivers. `overlay` cannot emit a frame until both of
 * its inputs have one, so the writer must keep at least this many frames per second available: an
 * overlay input starved below this rate throttles the entire encode, not just the overlay.
 */
export const ON_AIR_SCENE_PIPE_FRAMERATE = 1;

/** Budget for a single written frame before the overlay input runs dry. */
export const ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS = 1000 / ON_AIR_SCENE_PIPE_FRAMERATE;

/**
 * Bound on ffmpeg's own input packet queue for the overlay.
 *
 * This does NOT bound how stale the overlay can get. Frames sit in Node's stream buffer and the OS
 * pipe buffer before they ever reach this queue, and those hold many more frames than it does — a
 * transparent lower third compresses small, so the cheaper the frame the deeper the backlog. Only
 * the writer's own pacing can bound staleness; see ON_AIR_SCENE_PIPE_LEAD_FRAMES.
 */
export const ON_AIR_SCENE_PIPE_QUEUE_FRAMES = 4;

/**
 * How many frames the writer may run ahead of real time.
 *
 * This is the actual staleness bound: the writer paces against the wall clock rather than writing
 * until something pushes back, so a scene change waits at most this many frames. Large enough that
 * the overlay input never runs dry if a rasterisation is slow — starving it throttles the entire
 * encode, which is the failure this whole arrangement exists to prevent.
 */
export const ON_AIR_SCENE_PIPE_LEAD_FRAMES = 4;

/**
 * Frames that should have been handed to ffmpeg by `nowMs`, including the lead.
 *
 * Derived from elapsed wall-clock time rather than from a running counter, so a writer that was
 * blocked on a full pipe catches up by itself instead of drifting permanently behind.
 */
export function framesDueByNow(startedAtMs: number, nowMs: number, leadFrames: number): number {
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.floor(elapsedMs / ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS) + leadFrames;
}

export function getSceneRendererBaseUrl(env: NodeJS.ProcessEnv): string {
  // Deliberately env-only, unlike the resolvers in @stream247/db: this is the *internal* address
  // the renderer fetches frames from inside the compose network, and the wizard-managed app URL
  // names the *public* entry point. Routing frame capture through the public proxy because someone
  // set their public URL in the wizard would be a regression, so a wizard-only install correctly
  // falls through to http://web:3000 here.
  return String(env.SCENE_RENDER_BASE_URL || env.INTERNAL_APP_URL || env.APP_URL || "http://web:3000").replace(/\/+$/, "");
}

export function getSceneRendererViewport(
  env: NodeJS.ProcessEnv,
  outputSettings?: StreamOutputSettings | null
): { width: number; height: number } {
  const output = resolveStreamOutputSettings({ settings: outputSettings, env });
  const width = Number(env.SCENE_RENDER_WIDTH || output.width) || output.width;
  const height = Number(env.SCENE_RENDER_HEIGHT || output.height) || output.height;
  return {
    width: Math.max(640, width),
    height: Math.max(360, height)
  };
}

export function getSceneRendererIntervalMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.SCENE_RENDER_INTERVAL_MS || "2000") || 2000;
  return Math.max(1000, configured);
}
