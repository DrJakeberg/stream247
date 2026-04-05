export type OnAirOverlayMode = "none" | "text" | "scene";

export const ON_AIR_SCENE_PIPE_FD = 3;

export function getSceneRendererBaseUrl(env: NodeJS.ProcessEnv): string {
  return String(env.SCENE_RENDER_BASE_URL || env.INTERNAL_APP_URL || env.APP_URL || "http://web:3000").replace(/\/+$/, "");
}

export function getSceneRendererOverlayUrl(env: NodeJS.ProcessEnv): string {
  return `${getSceneRendererBaseUrl(env)}/overlay?chromeless=1`;
}

export function getSceneRendererViewport(env: NodeJS.ProcessEnv): { width: number; height: number } {
  const width = Number(env.SCENE_RENDER_WIDTH || "1280") || 1280;
  const height = Number(env.SCENE_RENDER_HEIGHT || "720") || 720;
  return {
    width: Math.max(640, width),
    height: Math.max(360, height)
  };
}

export function getSceneRendererIntervalMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.SCENE_RENDER_INTERVAL_MS || "2000") || 2000;
  return Math.max(1000, configured);
}

export function getChromiumBinaryCandidates(env: NodeJS.ProcessEnv): string[] {
  return [
    env.SCENE_RENDER_CHROMIUM_PATH || "",
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium"
  ].filter(Boolean);
}

export function buildChromiumSceneCaptureArgs(args: {
  url: string;
  outputPath: string;
  viewport: { width: number; height: number };
}): string[] {
  return [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    `--window-size=${args.viewport.width},${args.viewport.height}`,
    "--default-background-color=00000000",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=4000",
    `--screenshot=${args.outputPath}`,
    args.url
  ];
}
