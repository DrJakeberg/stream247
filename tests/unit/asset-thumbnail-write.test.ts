import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureLocalAssetThumbnail,
  getAssetThumbnailPath,
  getAssetThumbnailTempPath,
  getThumbnailDirectory
} from "../../apps/worker/src/asset-thumbnails.js";

const GOOD_THUMBNAIL = "GOOD-THUMBNAIL-BYTES";

/** A media root with one source file and one already-generated thumbnail that is older than it. */
function makeLibrary(): { mediaRoot: string; inputPath: string; thumbnailPath: string } {
  const mediaRoot = mkdtempSync(path.join(tmpdir(), "stream247-thumb-"));
  const inputPath = path.join(mediaRoot, "episode.mp4");
  writeFileSync(inputPath, "media");

  const thumbnailPath = getAssetThumbnailPath("asset_1", mediaRoot);
  mkdirSync(getThumbnailDirectory(mediaRoot), { recursive: true });
  writeFileSync(thumbnailPath, GOOD_THUMBNAIL);
  // Older than the media file, so the freshness shortcut does not skip regeneration.
  const stale = new Date(Date.now() - 60_000);
  utimesSync(thumbnailPath, stale, stale);

  return { mediaRoot, inputPath, thumbnailPath };
}

function writeFakeFfmpeg(directory: string, body: string): string {
  const scriptPath = path.join(directory, "fake-ffmpeg.sh");
  writeFileSync(scriptPath, body);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe("thumbnail regeneration", () => {
  it("keeps the existing thumbnail when the render fails", async () => {
    const { mediaRoot, inputPath, thumbnailPath } = makeLibrary();

    // /bin/false stands in for the real failure modes: OOM, load, a full disk, a killed ffmpeg.
    const rendered = await ensureLocalAssetThumbnail({
      assetId: "asset_1",
      inputPath,
      mediaRoot,
      ffmpegBinary: "/bin/false"
    });

    expect(rendered).toBe(false);
    // The old behaviour unlinked the good thumbnail up front and let ffmpeg -y write straight to
    // the target, so a failed render left the asset with no picture — or a truncated one.
    expect(readFileSync(thumbnailPath, "utf8")).toBe(GOOD_THUMBNAIL);
  });

  it("leaves no temp file behind after a failed render", async () => {
    const { mediaRoot, inputPath } = makeLibrary();

    await ensureLocalAssetThumbnail({ assetId: "asset_1", inputPath, mediaRoot, ffmpegBinary: "/bin/false" });

    expect(readdirSync(getThumbnailDirectory(mediaRoot)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("publishes the new frame only once the render finished", async () => {
    const { mediaRoot, inputPath, thumbnailPath } = makeLibrary();
    // Writes to the last argument, which is where the render target is passed.
    const ffmpegBinary = writeFakeFfmpeg(mediaRoot, '#!/bin/sh\nfor arg in "$@"; do last="$arg"; done\nprintf NEW > "$last"\n');

    const rendered = await ensureLocalAssetThumbnail({ assetId: "asset_1", inputPath, mediaRoot, ffmpegBinary });

    expect(rendered).toBe(true);
    expect(readFileSync(thumbnailPath, "utf8")).toBe("NEW");
    expect(readdirSync(getThumbnailDirectory(mediaRoot)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("renders to a temp path that is not the path readers serve", () => {
    expect(getAssetThumbnailTempPath("asset_1", "/media")).not.toBe(getAssetThumbnailPath("asset_1", "/media"));
    expect(getAssetThumbnailTempPath("asset_1", "/media").startsWith(getAssetThumbnailPath("asset_1", "/media"))).toBe(true);
  });
});
