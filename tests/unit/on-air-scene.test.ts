import { describe, expect, it } from "vitest";
import {
  getSceneRendererIntervalMs,
  getSceneRendererViewport
} from "../../apps/worker/src/on-air-scene";

// The Chromium screenshot path this file used to cover is gone: the on-air scene is now rendered
// natively (apps/worker/src/scene-renderer.ts). What remains here is the geometry and cadence the
// renderer still takes from the environment.

describe("on-air scene helpers", () => {
  it("normalizes viewport and interval defaults", () => {
    expect(getSceneRendererViewport({})).toEqual({
      width: 1280,
      height: 720
    });
    expect(
      getSceneRendererViewport({
        SCENE_RENDER_WIDTH: "320",
        SCENE_RENDER_HEIGHT: "200"
      })
    ).toEqual({
      width: 640,
      height: 360
    });
    expect(
      getSceneRendererViewport({
        STREAM_OUTPUT_WIDTH: "1920",
        STREAM_OUTPUT_HEIGHT: "1080"
      })
    ).toEqual({
      width: 1920,
      height: 1080
    });
    expect(
      getSceneRendererViewport({
        STREAM_OUTPUT_WIDTH: "1920",
        STREAM_OUTPUT_HEIGHT: "1080",
        SCENE_RENDER_WIDTH: "1280",
        SCENE_RENDER_HEIGHT: "720"
      })
    ).toEqual({
      width: 1280,
      height: 720
    });
    expect(
      getSceneRendererIntervalMs({
        SCENE_RENDER_INTERVAL_MS: "250"
      })
    ).toBe(1000);
    expect(getSceneRendererIntervalMs({})).toBe(2000);
  });
});
