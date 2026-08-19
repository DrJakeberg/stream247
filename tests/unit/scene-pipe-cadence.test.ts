import { describe, expect, it } from "vitest";
import {
  ON_AIR_SCENE_PIPE_FRAMERATE,
  ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS,
  ON_AIR_SCENE_PIPE_LEAD_FRAMES,
  framesDueByNow,
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

  it("stays ahead of ffmpeg from the very first moment", () => {
    // The lead is what stops the overlay input running dry, and a dry overlay input throttles the
    // whole encode -- not just the overlay.
    expect(framesDueByNow(0, 0, ON_AIR_SCENE_PIPE_LEAD_FRAMES)).toBe(ON_AIR_SCENE_PIPE_LEAD_FRAMES);
    expect(ON_AIR_SCENE_PIPE_LEAD_FRAMES).toBeGreaterThan(1);
  });

  it("lets the due count track real time, one frame per declared interval", () => {
    const lead = ON_AIR_SCENE_PIPE_LEAD_FRAMES;
    const interval = ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS;

    expect(framesDueByNow(1_000, 1_000 + interval, lead)).toBe(lead + 1);
    expect(framesDueByNow(1_000, 1_000 + 10 * interval, lead)).toBe(lead + 10);
    // Partial intervals do not earn a frame, so the writer cannot creep ahead of the clock.
    expect(framesDueByNow(1_000, 1_000 + interval - 1, lead)).toBe(lead);
  });

  it("bounds how far ahead the writer may ever run", () => {
    // This is the staleness bound. Buffer sizes cannot provide one: frames queue in Node's stream
    // buffer and the OS pipe long before ffmpeg's own queue, and a cheaply compressing overlay
    // makes that backlog deeper, not shallower.
    const lead = ON_AIR_SCENE_PIPE_LEAD_FRAMES;
    const interval = ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS;

    for (const elapsedMs of [0, 500, 5_000, 3_600_000]) {
      const due = framesDueByNow(0, elapsedMs, lead);
      const consumedByFfmpeg = Math.floor(elapsedMs / interval);
      expect(due - consumedByFfmpeg).toBe(lead);
    }
  });

  it("does not run the clock backwards if time appears to move backwards", () => {
    expect(framesDueByNow(5_000, 1_000, ON_AIR_SCENE_PIPE_LEAD_FRAMES)).toBe(ON_AIR_SCENE_PIPE_LEAD_FRAMES);
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
