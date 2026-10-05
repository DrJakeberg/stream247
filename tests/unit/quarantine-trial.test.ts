import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decideQuarantineTrialMode } from "../../apps/worker/src/quarantine-trial";

// M105, review finding R34: the daily trial of a quarantined Twitch archive that was not in the cache queued
// its full download ahead of the downloads the programme needed.

describe("decideQuarantineTrialMode", () => {
  it("asks an uncached Twitch archive only whether it resolves", () => {
    expect(decideQuarantineTrialMode({ twitchArchive: true, cacheReady: false, settledTooLarge: false })).toBe("availability");
  });

  it("tries a cached archive, one settled as too large, and every other item with the ordinary resolve", () => {
    expect(decideQuarantineTrialMode({ twitchArchive: true, cacheReady: true, settledTooLarge: false })).toBe("resolve");
    expect(decideQuarantineTrialMode({ twitchArchive: true, cacheReady: false, settledTooLarge: true })).toBe("resolve");
    expect(decideQuarantineTrialMode({ twitchArchive: false, cacheReady: false, settledTooLarge: false })).toBe("resolve");
  });
});

describe("R34 wiring in the worker", () => {
  const source = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
  const flat = source.replace(/\s+/g, " ");
  const between = (from: string, to: string) => flat.slice(flat.indexOf(from), flat.indexOf(to, flat.indexOf(from) + from.length));

  it("sends only the trials through the trial resolver, the queue's own items through the ordinary one", () => {
    expect(flat).toContain(
      "const resolveInto = isReprobe(index) ? resolveQuarantineTrialIntoProbeCache : resolveQueueAssetIntoProbeCache;"
    );
    expect(flat).toContain("const prepared = await resolveInto(asset);");
    expect(flat).toContain("const outcome = await raceResolveAgainstDeath(resolveInto(asset), death?.promise ?? null);");
    expect(flat.match(/resolveQueueAssetIntoProbeCache\(asset\)/g)?.length).toBe(2);
  });

  it("asks Twitch without the download runner and caches no remote address for an uncached archive", () => {
    const trial = between("function resolveQuarantineTrialIntoProbeCache(", "// The early re-resolve of a warm entry");
    expect(trial).toContain("peekTwitchVodCache(asset, getTwitchVodCacheRuntimeConfig())");
    expect(trial).toContain('cacheReady: cache.status === "ready", settledTooLarge: asset.cacheStatus === "too-large"');
    const availability = between("function checkTwitchArchiveAvailability(", "// The early re-resolve of a warm entry");
    expect(availability).toContain("return resolvePlayableMedia(asset.path)");
    expect(availability).not.toContain("vodCacheJobRunner");
    expect(availability).not.toContain("resolveAssetPlaybackInput");
    expect(availability).not.toContain('status: "ready"');
  });

  it("leaves the queue's own items to the ordinary resolve, which still requests their download", () => {
    expect(flat.match(/vodCacheJobRunner\.request\(asset, cacheConfig\);/g)?.length).toBe(1);
  });
});
