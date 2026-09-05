import { describe, expect, it } from "vitest";
import { overlayAssetDisplayTitle, overlayOnAirChapterTitle, serializeAssetChapters } from "@stream247/core";

/**
 * The title on air and the title in the studio, from one place.
 *
 * The worker resolved a chapter-aware title — a long recording with chapters shows the chapter that
 * is actually playing, not the file's own name — and the web app knew nothing about chapters at
 * all. So the channel said "Advent of Code · Day 7" and the studio preview said "Advent of Code",
 * for the same second of the same asset. The preview exists to show what airs.
 *
 * Same shape as the time format and as the overlay mode before it: one concept, more than one
 * implementation, and nothing making them agree.
 */
const CHAPTERS = serializeAssetChapters([
  { offsetSeconds: 0, title: "Opening" },
  { offsetSeconds: 600, title: "Day 7" },
  { offsetSeconds: 1800, title: "Wrap up" }
]);

const STARTED = "2026-09-03T00:00:00.000Z";

function asset(overrides: Partial<{ id: string; chaptersJson: string; titlePrefix: string }> = {}) {
  return { id: "asset_1", chaptersJson: CHAPTERS, titlePrefix: "", ...overrides };
}

describe("on-air title", () => {
  it("names the chapter that is playing, not the one that started the asset", () => {
    expect(
      overlayOnAirChapterTitle({
        currentAssetId: "asset_1",
        processStartedAt: STARTED,
        asset: asset(),
        now: new Date("2026-09-03T00:15:00.000Z")
      })
    ).toBe("Day 7");
  });

  it("keeps the replay prefix, because a chapter changes what plays and not that it is a replay", () => {
    expect(
      overlayOnAirChapterTitle({
        currentAssetId: "asset_1",
        processStartedAt: STARTED,
        asset: asset({ titlePrefix: "Replay:" }),
        now: new Date("2026-09-03T00:15:00.000Z")
      })
    ).toBe("Replay: Day 7");
  });

  it("says nothing when the asset is not the one on air", () => {
    expect(
      overlayOnAirChapterTitle({
        currentAssetId: "asset_2",
        processStartedAt: STARTED,
        asset: asset(),
        now: new Date("2026-09-03T00:15:00.000Z")
      })
    ).toBe("");
  });

  it("says nothing without chapters, without an asset, or before anything started", () => {
    const now = new Date("2026-09-03T00:15:00.000Z");
    expect(overlayOnAirChapterTitle({ currentAssetId: "asset_1", processStartedAt: STARTED, asset: asset({ chaptersJson: "[]" }), now })).toBe("");
    expect(overlayOnAirChapterTitle({ currentAssetId: "asset_1", processStartedAt: STARTED, asset: null, now })).toBe("");
    expect(overlayOnAirChapterTitle({ currentAssetId: "asset_1", processStartedAt: "", asset: asset(), now })).toBe("");
  });

  it("falls back to nothing rather than to a synthetic chapter before the first offset", () => {
    const early = serializeAssetChapters([{ offsetSeconds: 600, title: "Day 7" }]);
    expect(
      overlayOnAirChapterTitle({
        currentAssetId: "asset_1",
        processStartedAt: STARTED,
        asset: asset({ chaptersJson: early }),
        now: new Date("2026-09-03T00:01:00.000Z")
      })
    ).toBe("");
  });

  it("builds a display title the same way wherever it is asked", () => {
    expect(overlayAssetDisplayTitle({ title: "Advent of Code", titlePrefix: "Replay:" })).toBe("Replay: Advent of Code");
    expect(overlayAssetDisplayTitle({ title: "Advent of Code", titlePrefix: "" })).toBe("Advent of Code");
    expect(overlayAssetDisplayTitle(null)).toBe("");
  });
});

describe("both sides ask the same question", () => {
  const sources = ["apps/web/lib/server/state.ts", "apps/worker/src/index.ts"];

  it("resolves the chapter through the one function, in the studio as on air", async () => {
    const { readFileSync } = await import("node:fs");
    for (const path of sources) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      expect({ path, uses: source.includes("overlayOnAirChapterTitle({") }).toEqual({ path, uses: true });
    }
  });

  it("leaves no private copy of the chapter resolver behind", async () => {
    const { readFileSync } = await import("node:fs");
    const worker = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");
    expect(worker).not.toContain("function resolveOnAirChapterTitle");
  });
});
