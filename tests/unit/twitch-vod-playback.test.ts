import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decideTwitchVodPlaybackSource, isTwitchVodPlaybackAsset } from "@stream247/core";
import { isTwitchVodAsset } from "../../apps/worker/src/twitch-vod-cache";

// M74: the admin's Play now and Insert refuse an archive the playout cannot start, by the playout's own
// rule. One function decides for both, so the refusal and the playout cannot drift apart.
describe("where the playout can start a Twitch archive from", () => {
  it.each([
    // cacheReady, settledTooLarge, allowRemoteFallback -> source
    [true, false, false, "cache"],
    [true, true, true, "cache"],
    [false, true, false, "remote"], // oversized: always streamed, whatever the switch says
    [false, false, true, "remote"],
    [false, false, false, "unavailable"] // the DUT on 2026-10-01: not downloaded, fallback off
  ] as const)("cached=%s tooLarge=%s remoteFallback=%s -> %s", (cacheReady, settledTooLarge, allowRemoteFallback, source) => {
    expect(decideTwitchVodPlaybackSource({ cacheReady, settledTooLarge, allowRemoteFallback })).toBe(source);
  });

  it.each([
    [{ path: "https://www.twitch.tv/videos/2571234567" }, true],
    [{ path: "https://twitch.tv/videos/1" }, true],
    [{ path: "/app/data/media/archive.mp4", cachePath: "/app/data/media/.stream247-cache/twitch/x.mp4" }, true],
    [{ path: "https://www.youtube.com/watch?v=abc" }, false],
    [{ path: "https://www.twitch.tv/jimpanse247" }, false],
    [{ path: "/app/data/media/fallback.mp4" }, false],
    [{ path: "not a url" }, false]
  ])("%j is a Twitch archive: %s -- for the admin and the playout alike", (asset, expected) => {
    expect(isTwitchVodPlaybackAsset(asset)).toBe(expected);
    expect(isTwitchVodAsset({ externalId: "", ...asset })).toBe(expected);
  });

  it("is the decision resolveAssetPlaybackInput and the admin action both make", () => {
    const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
    const resolve = workerSource.slice(workerSource.indexOf("async function resolveAssetPlaybackInput("));
    const body = resolve.slice(0, resolve.indexOf("\nfunction "));
    expect(body).toContain("decideTwitchVodPlaybackSource({");
    expect(body).toContain('if (playbackSource === "cache")');
    expect(body).toContain('if (playbackSource === "remote")');
    expect(body).not.toContain("settledTooLarge || cacheConfig.allowRemoteFallback");
    const webSource = readFileSync(path.join(process.cwd(), "apps/web/lib/server/broadcast.ts"), "utf8");
    expect(webSource).toContain("isTwitchVodPlaybackAsset(asset) &&");
    expect(webSource).toContain("decideTwitchVodPlaybackSource({");
  });
});
