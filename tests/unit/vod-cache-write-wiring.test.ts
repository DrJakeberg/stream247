import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// M72. Both cache writes in the worker used updateAssetRecords with an asset snapshot taken before a
// download that can run for hours, so the write reverted every field a sync or an operator had changed
// in the meantime. apps/worker/src/index.ts starts a worker on import, so the wiring is pinned against
// the source text, the way youtube-playback-wiring.test.ts does it.
const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");

function section(startMarker: string, length = 2500): string {
  const start = workerSource.indexOf(startMarker);
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1);
  return workerSource.slice(start, start + length);
}

describe("VOD cache writes", () => {
  it("no longer writes whole asset records from the worker", () => {
    expect(workerSource).not.toContain("updateAssetRecords");
  });

  it("writes only the cache columns when a download job finishes", () => {
    const onResult = section("async onResult(asset, result) {", 1200);
    expect(onResult).toContain("await updateAssetCacheRecords([");
    expect(onResult).not.toContain("...asset");
  });

  it("writes only the cache columns when playback looks the cache up", () => {
    const resolve = section("async function resolveAssetPlaybackInput(", 4000);
    expect(resolve).toContain("await updateAssetCacheRecords([");
  });
});
