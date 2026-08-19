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

export function getSceneRendererBaseUrl(env: NodeJS.ProcessEnv): string {
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
