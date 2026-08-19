import { describe, expect, it } from "vitest";
import {
  ON_AIR_SCENE_PIPE_FRAMERATE,
  ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS,
  getSceneRendererIntervalMs
} from "../../apps/worker/src/on-air-scene.js";

// Regression guard for a stream that ran at half speed.
//
// ffmpeg is told the overlay pipe delivers ON_AIR_SCENE_PIPE_FRAMERATE frames per second, and the
// `overlay` filter cannot emit anything until *both* of its inputs have a frame. So the writer does
// not merely decide how fresh the lower third looks -- it sets the pace of the entire encode. When
// the writer paused for the render interval (2000ms) between frames, a pipe declared at 1fps got
// 0.5fps, and playout produced 30 seconds of programme per minute of wall clock. The viewer saw
// that as the stream falling steadily further behind.
//
// The declared rate lived in index.ts and the render cadence in on-air-scene.ts: two unrelated
// numbers in two files that silently had to agree. These tests pin the relationship instead.

describe("overlay pipe cadence", () => {
  it("declares a frame interval consistent with its framerate", () => {
    expect(ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS).toBe(1000 / ON_AIR_SCENE_PIPE_FRAMERATE);
  });

  it("keeps the write cadence ahead of what ffmpeg consumes", () => {
    // Mirrors the writer's own computation. The margin matters: a writer running at exactly the
    // declared rate still loses ground, because each pass also costs a render and a pipe write.
    const writeIntervalMs = Math.max(100, Math.floor(ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS / 2));

    expect(writeIntervalMs).toBeLessThan(ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS);
  });

  it("tolerates a render cadence slower than the pipe needs", () => {
    // The default render interval is deliberately slower than the pipe's frame interval -- there is
    // no reason to rasterise an unchanged lower third every second. That is only safe because the
    // writer re-pushes the cached frame instead of waiting for the renderer.
    const renderIntervalMs = getSceneRendererIntervalMs({} as NodeJS.ProcessEnv);

    expect(renderIntervalMs).toBeGreaterThan(ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS);
  });

  it("never lets configuration drive the render loop below the clamp", () => {
    expect(getSceneRendererIntervalMs({ SCENE_RENDER_INTERVAL_MS: "10" } as NodeJS.ProcessEnv)).toBe(1000);
    expect(getSceneRendererIntervalMs({ SCENE_RENDER_INTERVAL_MS: "nonsense" } as NodeJS.ProcessEnv)).toBe(2000);
  });
});
