import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  buildOverlayScenePayload,
  buildOverlayTextLinesFromScenePayload,
  type ScheduleBlock
} from "@stream247/core";
import {
  buildStandbySlateSceneInput,
  resolveStandbySlateQueueKind,
  shouldPrimeScenePayload
} from "../../apps/worker/src/standby-slate";
import { loadSceneRendererFonts, renderSceneFrame, type SceneRenderFont } from "../../apps/worker/src/scene-renderer";
import { layoutTexts, storedDefaults } from "./viewer-language-helpers";

/**
 * M102 (W8): the standby and reconnect slate shows standby, never the item that played before it.
 *
 * In scene mode the renderer draws the cached payload, and before M102 only a programme or a Live Bridge
 * cached one: the slate wrote its text file and left the picture on the previous item's lower third,
 * its title under "Now Playing". The worker now builds the slate's payload from the schedule alone and
 * caches it whenever the slate goes on air.
 */

// Monday 2026-10-05, 10:00 in UTC.
const NOW = new Date("2026-10-05T10:00:00.000Z");
const PREVIOUS_ITEM_TITLE = "Previous Item That Just Ended";

function block(overrides: Partial<ScheduleBlock>): ScheduleBlock {
  return {
    id: "block",
    title: "Block",
    categoryName: "Retro",
    dayOfWeek: 1,
    startMinuteOfDay: 0,
    durationMinutes: 60,
    sourceName: "Local Media Library",
    ...overrides
  };
}

const BLOCKS: ScheduleBlock[] = [
  block({ id: "morning", title: "Morning Retro", startMinuteOfDay: 9 * 60, durationMinutes: 120 }),
  block({ id: "evening", title: "Evening Show", startMinuteOfDay: 20 * 60, durationMinutes: 60 })
];

function slatePayload(args: { locale?: string; blocks?: ScheduleBlock[]; queueKind?: string } = {}) {
  const locale = args.locale ?? "en";
  const slate = buildStandbySlateSceneInput({
    now: NOW,
    timeZone: "UTC",
    locale,
    scheduleBlocks: args.blocks ?? BLOCKS,
    queuePreviewCount: 2,
    queueKind: args.queueKind ?? "standby"
  });
  // The same call the worker makes in buildWorkerScenePayload, with the stored overlay defaults.
  return buildOverlayScenePayload({
    overlay: storedDefaults(),
    queueKind: slate.queueKind,
    target: "on-air-text",
    currentTitle: slate.currentTitle,
    currentCategory: slate.currentCategory,
    currentSourceName: slate.currentSourceName,
    nextTitle: slate.nextTitle,
    nextTimeLabel: slate.nextTimeLabel,
    queueTitles: slate.queueTitles,
    timeZone: "UTC",
    locale
  });
}

describe("the slate's kind", () => {
  it("keeps standby, reconnect and live, and draws anything else as standby", () => {
    expect(resolveStandbySlateQueueKind("standby")).toBe("standby");
    expect(resolveStandbySlateQueueKind("reconnect")).toBe("reconnect");
    expect(resolveStandbySlateQueueKind("live")).toBe("live");
    // The queue head can name the asset that is about to play; the slate is not that asset.
    expect(resolveStandbySlateQueueKind("asset")).toBe("standby");
    expect(resolveStandbySlateQueueKind("insert")).toBe("standby");
    expect(resolveStandbySlateQueueKind("")).toBe("standby");
    expect(resolveStandbySlateQueueKind(undefined)).toBe("standby");
  });
});

describe("the slate's payload", () => {
  it("names the current block and the next one, from the schedule alone", () => {
    const slate = buildStandbySlateSceneInput({
      now: NOW,
      timeZone: "UTC",
      locale: "en",
      scheduleBlocks: BLOCKS,
      queuePreviewCount: 2,
      queueKind: "standby"
    });
    expect(slate).toMatchObject({
      queueKind: "standby",
      currentTitle: "Morning Retro",
      nextTitle: "Evening Show",
      queueTitles: ["Evening Show"]
    });
    expect(slate.nextScheduleItem?.title).toBe("Evening Show");
    expect(slate.nextTimeLabel).toBe("20:00-21:00 · in 10 h");
  });

  it("is a standby picture: the standby preset, the standby label, never the previous item", () => {
    const payload = slatePayload();
    expect(payload.queueKind).toBe("standby");
    expect(payload.scene.resolvedPresetId).toBe("standby-board");
    expect(payload.heroLabel).toBe("Stand by");
    expect(payload.heroTitle).toBe("Morning Retro");
    expect(payload.heroBody).toBe("Stand by, we’ll be right back");
    expect(payload.nextTitle).toBe("Evening Show");
    // The meta line names a category and source only for something on air.
    expect(payload.metaLine).toBe("");
    expect(JSON.stringify(payload)).not.toContain(PREVIOUS_ITEM_TITLE);
    expect(JSON.stringify(payload)).not.toContain("Now Playing");
  });

  it("says Stand by without a block on air, in the channel language", () => {
    expect(slatePayload({ blocks: [] }).heroTitle).toBe("Stand by");
    const german = slatePayload({ blocks: [], locale: "de" });
    expect(german.heroLabel).toBe("Gleich geht’s weiter");
    expect(german.heroTitle).toBe("Gleich geht’s weiter");
  });

  it("is the reconnect picture during a reconnect", () => {
    const payload = slatePayload({ queueKind: "reconnect" });
    expect(payload.scene.resolvedPresetId).toBe("reconnect-board");
    expect(payload.heroLabel).toBe("Reconnect Window");
    expect(payload.heroTitle).toBe("Morning Retro");
  });

  it("does not read Now Playing when the queue head is an asset", () => {
    const payload = slatePayload({ queueKind: "asset" });
    expect(payload.queueKind).toBe("standby");
    expect(payload.heroLabel).toBe("Stand by");
  });

  it("gives the text lines and the picture the same payload", () => {
    const lines = buildOverlayTextLinesFromScenePayload(slatePayload());
    expect(lines.join("\n")).toContain("Morning Retro");
    expect(lines.join("\n")).not.toContain(PREVIOUS_ITEM_TITLE);
  });
});

describe("priming the payload before a playout's first frame", () => {
  it("primes without a payload, and over a slate when a programme starts", () => {
    expect(shouldPrimeScenePayload({ hasPayload: false, payloadIsSlate: false, startingAsset: false })).toBe(true);
    expect(shouldPrimeScenePayload({ hasPayload: false, payloadIsSlate: false, startingAsset: true })).toBe(true);
    expect(shouldPrimeScenePayload({ hasPayload: true, payloadIsSlate: true, startingAsset: true })).toBe(true);
    // A slate starting over its own payload, and anything over a programme's payload, keep it.
    expect(shouldPrimeScenePayload({ hasPayload: true, payloadIsSlate: true, startingAsset: false })).toBe(false);
    expect(shouldPrimeScenePayload({ hasPayload: true, payloadIsSlate: false, startingAsset: true })).toBe(false);
    expect(shouldPrimeScenePayload({ hasPayload: true, payloadIsSlate: false, startingAsset: false })).toBe(false);
  });
});

describe("the worker's wiring", () => {
  const worker = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
  const body = (name: string) => {
    const start = worker.indexOf(`async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = worker.indexOf("\n}\n", start);
    return worker.slice(start, end);
  };

  it("caches the slate's payload for the scene picture", () => {
    const slate = body("writeStandbySlate");
    expect(slate).toContain("buildStandbySlateSceneInput(");
    expect(slate).toContain("currentScenePayload = payload;");
    expect(slate).toContain("currentScenePayloadIsSlate = true;");
    // The slate reads nothing of the programme before it.
    expect(slate).not.toContain("currentTitle: state.playout");
    expect(slate).not.toContain("currentAssetId");
  });

  it("marks a programme's payload as not a slate, and primes through the shared rule", () => {
    expect(body("writeOnAirOverlay")).toContain("currentScenePayloadIsSlate = false;");
    expect(body("ensureScenePayload")).toContain("shouldPrimeScenePayload(");
  });

  it("primes a slate start with the slate's own payload, not the playout row's last title", () => {
    const prime = body("ensureScenePayload");
    expect(prime).toContain("if (!asset && !liveBridge) {");
    expect(prime).toContain('await writeStandbySlate(state, state.playout.queueItems[0]?.kind || "standby");');
    expect(prime).toContain('state.playout.liveBridgeInputUrl !== ""');
  });

  it("sets the picture only with the overlay on, where a scene is drawn", () => {
    expect(body("writeStandbySlate")).toContain("if (options.scene !== false && state.overlay.enabled) {");
  });

  it("leaves the picture alone where a refresh only rewrites the slate's text under a running programme", () => {
    const calls = worker.match(/await writeStandbySlate\([^;]*\);/g) ?? [];
    expect(calls.filter((call) => call.includes("{ scene: false }"))).toEqual([
      'await writeStandbySlate(state, "live", { scene: false });',
      'await writeStandbySlate(state, state.playout.queueItems[0]?.kind || "standby", { scene: false });'
    ]);
    // Every other call puts the slate on air and so sets the picture.
    expect(calls.length).toBeGreaterThanOrEqual(9);
  });
});

describe("the standby frame", () => {
  const FRAME = { width: 1920, height: 1080, now: NOW };

  it("matches its baseline: the texts the standby picture draws, in order", async () => {
    const texts = layoutTexts(buildOverlaySceneLayout({ payload: slatePayload() }, FRAME));
    expect(texts).not.toContain(PREVIOUS_ITEM_TITLE);
    expect(texts).toContain("Morning Retro");
    await expect(`${texts.join("\n")}\n`).toMatchFileSnapshot("./baselines/standby-frame.txt");
  });

  it("matches its baseline in German", async () => {
    const texts = layoutTexts(buildOverlaySceneLayout({ payload: slatePayload({ locale: "de", blocks: [] }) }, FRAME));
    await expect(`${texts.join("\n")}\n`).toMatchFileSnapshot("./baselines/standby-frame-de.txt");
  });

  it("rasterises to a PNG", async () => {
    let fonts: SceneRenderFont[];
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      // No usable font on this machine: inconclusive, like the other render smokes.
      return;
    }
    const png = await renderSceneFrame({ payload: slatePayload(), width: 1280, height: 720, now: NOW }, fonts);
    expect(png.length).toBeGreaterThan(1000);
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
