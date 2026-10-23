import { spawnSync } from "node:child_process";

/**
 * Whether the named media tools (ffmpeg, ffprobe) run on this machine.
 *
 * Tests that need real ffmpeg skip without it, so `pnpm test` stays usable on a laptop without
 * ffmpeg. CI must not skip them silently (M121): `pnpm test:media` sets STREAM247_REQUIRE_MEDIA_TOOLS=1,
 * and then a missing tool fails the file instead of skipping it.
 */
export function mediaToolsAvailable(...tools: string[]): boolean {
  const missing = tools.filter((tool) => spawnSync(tool, ["-hide_banner", "-version"]).status !== 0);
  if (missing.length > 0 && process.env.STREAM247_REQUIRE_MEDIA_TOOLS === "1") {
    throw new Error(`STREAM247_REQUIRE_MEDIA_TOOLS=1 but ${missing.join(" and ")} did not run.`);
  }
  return missing.length === 0;
}
