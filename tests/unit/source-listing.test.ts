import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFlatListingArgs, resolveListingEntryPublishedAt } from "../../apps/worker/src/source-listing.js";

// M72. A flat YouTube tab listing carries a date only with `youtubetab:approximate_date` (measured on
// the DUT 2026-10-01); Twitch flat archives carry none and are ordered by VOD id instead.
describe("flat source listing arguments", () => {
  it("asks YouTube channel and playlist tabs for approximate dates, before the URL", () => {
    for (const connectorKind of ["youtube-channel", "youtube-playlist"] as const) {
      const args = buildFlatListingArgs({ url: "https://www.youtube.com/@example", connectorKind, playlistEnd: "200" });
      expect(args).toEqual([
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-end",
        "200",
        "--extractor-args",
        "youtubetab:approximate_date",
        "https://www.youtube.com/@example"
      ]);
      expect(args.at(-1)).toBe("https://www.youtube.com/@example");
    }
  });

  it("leaves the Twitch archive listing as it was", () => {
    expect(
      buildFlatListingArgs({
        url: "https://www.twitch.tv/example/videos?filter=archives&sort=time",
        connectorKind: "twitch-channel",
        playlistEnd: "50"
      })
    ).toEqual(["--flat-playlist", "--dump-single-json", "--playlist-end", "50", "https://www.twitch.tv/example/videos?filter=archives&sort=time"]);
  });
});

describe("listing entry publish date", () => {
  it("prefers the timestamp", () => {
    expect(resolveListingEntryPublishedAt({ timestamp: 1782864000, upload_date: "20200101" })).toBe("2026-07-01T00:00:00.000Z");
  });

  it("falls back to upload_date read as UTC midnight", () => {
    expect(resolveListingEntryPublishedAt({ upload_date: "20260701" })).toBe("2026-07-01T00:00:00.000Z");
    expect(resolveListingEntryPublishedAt({ timestamp: Number.NaN, upload_date: "20260701" })).toBe("2026-07-01T00:00:00.000Z");
  });

  it("reports no date rather than a wrong one", () => {
    expect(resolveListingEntryPublishedAt({})).toBeUndefined();
    expect(resolveListingEntryPublishedAt({ upload_date: "" })).toBeUndefined();
    expect(resolveListingEntryPublishedAt({ upload_date: "2026-07-01" })).toBeUndefined();
    expect(resolveListingEntryPublishedAt({ upload_date: "20260231" })).toBeUndefined();
  });
});

describe("flat listing wiring", () => {
  // apps/worker/src/index.ts starts a worker on import, so the call sites are pinned on the source text.
  const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");

  it("builds every flat listing through the builder, with the source's connector kind", () => {
    expect(workerSource).toContain("buildFlatListingArgs({ url, connectorKind, playlistEnd:");
    expect(workerSource).not.toContain('"--flat-playlist"');
    expect(workerSource).toContain('source.connectorKind === "youtube-playlist" ? "youtube-playlist" : "youtube-channel"');
    expect(workerSource).toContain('loadFlatCollection(getTwitchArchiveUrl(externalUrl), "twitch-channel")');
  });

  it("reads the publish date of YouTube and Twitch listing entries through the upload_date fallback", () => {
    expect(workerSource.match(/publishedAt: resolveListingEntryPublishedAt\(entry\)/g)?.length).toBe(2);
  });
});
