import { describe, expect, it } from "vitest";
import {
  buildChromiumSceneCaptureArgs,
  getChromiumBinaryCandidates,
  getSceneRendererBaseUrl,
  getSceneRendererIntervalMs,
  getSceneRendererOverlayUrl,
  getSceneRendererViewport
} from "../../apps/worker/src/on-air-scene";

describe("on-air scene helpers", () => {
  it("prefers explicit internal render URLs before falling back", () => {
    expect(getSceneRendererBaseUrl({
      SCENE_RENDER_BASE_URL: "http://internal-render:3000/",
      INTERNAL_APP_URL: "http://web:3000",
      APP_URL: "https://stream247.example.com"
    })).toBe("http://internal-render:3000");

    expect(getSceneRendererOverlayUrl({
      INTERNAL_APP_URL: "http://web:3000/"
    })).toBe("http://web:3000/overlay?chromeless=1");
  });

  it("normalizes viewport and interval defaults", () => {
    expect(getSceneRendererViewport({})).toEqual({
      width: 1280,
      height: 720
    });
    expect(getSceneRendererViewport({
      SCENE_RENDER_WIDTH: "320",
      SCENE_RENDER_HEIGHT: "200"
    })).toEqual({
      width: 640,
      height: 360
    });
    expect(getSceneRendererIntervalMs({
      SCENE_RENDER_INTERVAL_MS: "250"
    })).toBe(1000);
  });

  it("builds chromium capture args for transparent overlay screenshots", () => {
    expect(
      buildChromiumSceneCaptureArgs({
        url: "http://web:3000/overlay?chromeless=1",
        outputPath: "/tmp/stream247-scene.png",
        viewport: {
          width: 1280,
          height: 720
        }
      })
    ).toContain("--default-background-color=00000000");
    expect(
      buildChromiumSceneCaptureArgs({
        url: "http://web:3000/overlay?chromeless=1",
        outputPath: "/tmp/stream247-scene.png",
        viewport: {
          width: 1280,
          height: 720
        }
      })
    ).toContain("--window-size=1280,720");
  });

  it("returns chromium binary candidates in preference order", () => {
    expect(getChromiumBinaryCandidates({
      SCENE_RENDER_CHROMIUM_PATH: "/custom/chromium",
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/playwright/chromium"
    })).toEqual([
      "/custom/chromium",
      "/playwright/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium"
    ]);
  });
});
