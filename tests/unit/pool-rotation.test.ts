import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMaterializedProgrammingWeek,
  buildSchedulePreview,
  createPoolRotation,
  lookaheadVideoTitleFromPool,
  nextPoolRotationAsset,
  parsePoolSourceCursors,
  poolSourcePositions,
  walkPoolRotation,
  type PoolRotationPool,
  type ProgrammingOrderAsset
} from "@stream247/core";

// M73. The DUT pool "TwitchYoutube" (2026-10-01) lists the Twitch channel first and the YouTube channel
// second. The YouTube items here are dated BEFORE every Twitch item on purpose: one date-sorted list
// would play them as one block, so only per-source alternation can produce T, Y, T, Y.
const TWITCH = "source_twitch";
const YOUTUBE = "source_youtube";

function item(sourceId: string, id: string, day: number): ProgrammingOrderAsset {
  return {
    id,
    sourceId,
    title: `Item ${id}`,
    createdAt: new Date(Date.UTC(2026, sourceId === YOUTUBE ? 6 : 8, day)).toISOString()
  };
}

const twitch = [item(TWITCH, "t1", 1), item(TWITCH, "t2", 2), item(TWITCH, "t3", 3)];
const youtube = [item(YOUTUBE, "y1", 1), item(YOUTUBE, "y2", 2)];
const assets = [...twitch, ...youtube];
const always = () => true;

function walk(
  pool: PoolRotationPool,
  steps: number,
  options: { assets?: ProgrammingOrderAsset[]; isEligible?: (asset: ProgrammingOrderAsset) => boolean } = {}
): string[] {
  return walkPoolRotation({
    pool,
    assets: options.assets ?? assets,
    isEligible: options.isEligible ?? always,
    steps
  }).map((pick) => pick.asset.id);
}

function except(...ids: string[]) {
  return (asset: ProgrammingOrderAsset) => !ids.includes(asset.id);
}

describe("pool rotation", () => {
  it("alternates the sources in pool order, each looping on its own", () => {
    const pool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "", sourceCursors: {} };
    expect(walk(pool, 9)).toEqual(["t1", "y1", "t2", "y2", "t3", "y1", "t1", "y2", "t2"]);
  });

  it("walks three sources in turn", () => {
    const extra = [item("source_c", "c1", 1), item("source_c", "c2", 2)];
    const pool = { sourceIds: [YOUTUBE, TWITCH, "source_c"], cursorAssetId: "", sourceCursors: {} };
    expect(walk(pool, 7, { assets: [...assets, ...extra] })).toEqual(["y1", "t1", "c1", "y2", "t2", "c2", "y1"]);
  });

  it("plays a one-source pool in order from the item after the cursor, and loops", () => {
    expect(walk({ sourceIds: [TWITCH], cursorAssetId: "t2", sourceCursors: { [TWITCH]: "t2" } }, 3)).toEqual(["t3", "t1", "t2"]);
    expect(walk({ sourceIds: [TWITCH], cursorAssetId: "", sourceCursors: {} }, 1)).toEqual(["t1"]);
  });

  it("steps over a skipped, quarantined or cooled-down item instead of restarting at the head", () => {
    // Skip holds the item that just played, which is the cursor itself: before M73 that sent the pool
    // back to its oldest item.
    const onePool = { sourceIds: [TWITCH], cursorAssetId: "t2", sourceCursors: { [TWITCH]: "t2" } };
    expect(walk(onePool, 1, { isEligible: except("t2") })).toEqual(["t3"]);
    expect(walk(onePool, 1, { isEligible: except("t2", "t3") })).toEqual(["t1"]);

    const twoPool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t1", sourceCursors: { [TWITCH]: "t1", [YOUTUBE]: "y1" } };
    expect(walk(twoPool, 3, { isEligible: except("t1", "y2") })).toEqual(["y1", "t2", "y1"]);
  });

  it("passes over a source with nothing eligible", () => {
    const pool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t1", sourceCursors: { [TWITCH]: "t1" } };
    expect(walk(pool, 3, { isEligible: (asset) => asset.sourceId !== YOUTUBE })).toEqual(["t2", "t3", "t1"]);
    // The last item came from a source that has nothing eligible now: the next source still follows it.
    const fromYoutube = { sourceIds: [TWITCH, YOUTUBE, "source_c"], cursorAssetId: "y1", sourceCursors: { [YOUTUBE]: "y1" } };
    const extra = [item("source_c", "c1", 1)];
    expect(
      walk(fromYoutube, 2, { assets: [...assets, ...extra], isEligible: (asset) => asset.sourceId !== YOUTUBE })
    ).toEqual(["c1", "t1"]);
    expect(walk(pool, 1, { isEligible: () => false })).toEqual([]);
  });

  it("restarts a source whose position vanished at its oldest item, while the alternation goes on", () => {
    // t_gone was the last Twitch item and has left the catalog; the per-source map still says it was Twitch.
    const pool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t_gone", sourceCursors: { [TWITCH]: "t_gone", [YOUTUBE]: "y1" } };
    expect(walk(pool, 3)).toEqual(["y2", "t1", "y1"]);
  });

  it("seeds a pool without per-source positions from its cursor", () => {
    // The DUT after the upgrade: cursor on a Twitch archive, source_cursors '{}'. The next pick is the
    // oldest YouTube item, and Twitch carries on after the cursor instead of at its head.
    const pool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t2", sourceCursors: {} };
    const first = nextPoolRotationAsset({ pool, assets, isEligible: always });
    expect(first?.asset.id).toBe("y1");
    expect(first?.state).toEqual({ cursorAssetId: "y1", sourceCursors: { [TWITCH]: "t2", [YOUTUBE]: "y1" } });
    expect(walk(pool, 4)).toEqual(["y1", "t3", "y2", "t1"]);
    expect(walk({ sourceIds: [TWITCH], cursorAssetId: "t2" }, 1)).toEqual(["t3"]);
  });

  it("lets the cursor set its own source's position over a stale stored one", () => {
    // A rollback to an image older than 2.1 moves only the cursor; the map keeps its 2.1 values. Back on
    // 2.1, Twitch carries on after the cursor (t2) instead of replaying from the stale entry (t1).
    const pool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t2", sourceCursors: { [TWITCH]: "t1", [YOUTUBE]: "y1" } };
    expect(walk(pool, 4)).toEqual(["y2", "t3", "y1", "t1"]);
    expect(walk({ sourceIds: [TWITCH], cursorAssetId: "t2", sourceCursors: { [TWITCH]: "t1" } }, 1)).toEqual(["t3"]);
  });

  it("reports where each source stands as the rotation reads it, for the asset page", () => {
    expect(poolSourcePositions({ sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t2", sourceCursors: { [YOUTUBE]: "y1" } }, assets)).toEqual({
      [TWITCH]: "t2",
      [YOUTUBE]: "y1"
    });
    expect(
      poolSourcePositions({ sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t2", sourceCursors: { [TWITCH]: "t1", [YOUTUBE]: "y1" } }, assets)
    ).toEqual({ [TWITCH]: "t2", [YOUTUBE]: "y1" });
    expect(poolSourcePositions({ sourceIds: [YOUTUBE], cursorAssetId: "t2", sourceCursors: { [YOUTUBE]: "y1" } }, assets)).toEqual({
      [YOUTUBE]: "y1"
    });
  });

  it("starts at the first source when the cursor is unknown or from a source the pool no longer has", () => {
    expect(walk({ sourceIds: [YOUTUBE, TWITCH], cursorAssetId: "missing", sourceCursors: {} }, 2)).toEqual(["y1", "t1"]);
    const other = [...assets, item("source_removed", "r1", 1)];
    expect(walk({ sourceIds: [YOUTUBE, TWITCH], cursorAssetId: "r1", sourceCursors: {} }, 2, { assets: other })).toEqual(["y1", "t1"]);
  });

  it("walks k steps exactly as k single picks with the state stored in between", () => {
    const isEligible = except("t2");
    let pool: PoolRotationPool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "y2", sourceCursors: { [TWITCH]: "t1" } };
    const walked = walkPoolRotation({ pool, assets, isEligible, steps: 7 });
    const single: string[] = [];
    for (let step = 0; step < 7; step += 1) {
      const pick = nextPoolRotationAsset({ pool, assets, isEligible });
      if (!pick) {
        break;
      }
      single.push(pick.asset.id);
      pool = { ...pool, ...pick.state };
    }
    expect(walked.map((pick) => pick.asset.id)).toEqual(single);
    expect(walked.at(-1)?.state).toEqual({ cursorAssetId: pool.cursorAssetId, sourceCursors: pool.sourceCursors });
  });

  it("gives one walk whatever order the database returned the rows in", () => {
    const rows = [twitch[2]!, youtube[0]!, twitch[0]!, youtube[1]!, twitch[1]!];
    const pool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t1", sourceCursors: { [TWITCH]: "t1" } };
    const expected = walk(pool, 6, { assets: rows });
    expect(expected).toEqual(["y1", "t2", "y2", "t3", "y1", "t1"]);
    for (const order of permutations(rows)) {
      expect(walk(pool, 6, { assets: order })).toEqual(expected);
    }
  });

  it("picks the oldest YouTube item after a Twitch cursor in the DUT's TwitchYoutube shape", () => {
    // 46 archives that share one created_at (their last 2.0 sync) and order by VOD id; 11 YouTube videos
    // with approximate publish dates. The cursor stands on the 10th archive; no per-source map yet.
    const sameSync = "2026-09-20T03:00:00.000Z";
    const archives = Array.from({ length: 46 }, (_, index) => ({
      id: `vod_${String(index)}`,
      sourceId: TWITCH,
      title: `Archive ${String(45 - index)}`,
      externalId: String(2500000000 + index * 1000),
      createdAt: sameSync
    }));
    const videos = Array.from({ length: 11 }, (_, index) => ({
      id: `yt_${String(index)}`,
      sourceId: YOUTUBE,
      title: `Video ${String(index)}`,
      publishedAt: new Date(Date.UTC(2026, 8, 11 - index)).toISOString(),
      createdAt: sameSync
    }));
    const pool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "vod_9", sourceCursors: {} };
    expect(walk(pool, 4, { assets: [...videos, ...archives] })).toEqual(["yt_10", "vod_10", "yt_9", "vod_11"]);
  });

  it("queues from the stored position while an item the pool never stored runs on", () => {
    // DUT shape: pools "Twitch" and "TwitchYoutube" share the Twitch source, and items run past block
    // ends. Pool "Twitch" started t3; it is still running inside a TwitchYoutube block, which stored y1
    // last and stands on t1 for Twitch. When t3 ends, the worker picks from the stored state.
    const pool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "y1", sourceCursors: { [TWITCH]: "t1", [YOUTUBE]: "y1" } };
    const picked = nextPoolRotationAsset({ pool, assets, isEligible: always });
    const queue = walkPoolRotation({ pool, assets, isEligible: always, steps: 2 });
    expect(picked?.asset.id).toBe("t2");
    expect(queue[0]?.asset.id).toBe(picked?.asset.id);
    // Walking on from the running item, as the queue did for every scheduled match, warms y2 instead.
    expect(walkPoolRotation({ pool, assets, isEligible: always, steps: 1, afterAssetId: "t3" })[0]?.asset.id).toBe("y2");
  });

  it("starts an item into the state the worker stores, and leaves the map alone for an outside item", () => {
    const rotation = createPoolRotation({ sourceIds: [TWITCH, YOUTUBE], assets, isEligible: always });
    expect(rotation.start({ cursorAssetId: "t2", sourceCursors: {} }, "y1")).toEqual({
      cursorAssetId: "y1",
      sourceCursors: { [TWITCH]: "t2", [YOUTUBE]: "y1" }
    });
    const outside = rotation.start({ cursorAssetId: "t2", sourceCursors: { [TWITCH]: "t2" } }, "insert_x");
    expect(outside).toEqual({ cursorAssetId: "insert_x", sourceCursors: { [TWITCH]: "t2" } });
  });

  it("reads stored positions defensively", () => {
    expect(parsePoolSourceCursors('{"source_twitch":"t1"}')).toEqual({ source_twitch: "t1" });
    expect(parsePoolSourceCursors("not json")).toEqual({});
    expect(parsePoolSourceCursors("[1,2]")).toEqual({});
    expect(parsePoolSourceCursors("null")).toEqual({});
    expect(parsePoolSourceCursors("")).toEqual({});
    expect(parsePoolSourceCursors('{"a":1,"b":"","c":"c1"}')).toEqual({ c: "c1" });
    expect(parsePoolSourceCursors({ a: "a1", b: { nested: true } })).toEqual({ a: "a1" });
  });
});

// The preview and the week lens walk the same rotation as the worker (packages/core).
describe("pool rotation in the previews", () => {
  const ready = (entry: ProgrammingOrderAsset, durationMinutes: number) => ({
    ...entry,
    status: "ready",
    includeInProgramming: true,
    durationSeconds: durationMinutes * 60
  });
  const previewAssets = [...twitch.map((entry) => ready(entry, 60)), ...youtube.map((entry) => ready(entry, 10))];
  const block = {
    id: "block_1",
    title: "Archive",
    categoryName: "Replay",
    dayOfWeek: 4,
    startMinuteOfDay: 0,
    durationMinutes: 600,
    poolId: "pool_1",
    sourceName: "TwitchYoutube"
  };

  it("alternates the schedule preview's video slots and the lookahead", () => {
    const pool = { id: "pool_1", sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t1", sourceCursors: {} };
    const preview = buildSchedulePreview({ date: "2026-10-01", blocks: [block], pools: [pool], assets: previewAssets, maxVideoSlotsPerBlock: 5 });
    expect(preview.items[0]?.videoSlots.map((slot) => slot.assetId)).toEqual(["y1", "t2", "y2", "t3", "y1"]);
    expect(lookaheadVideoTitleFromPool({ pool, assets: previewAssets })).toBe("Item y1");
    expect(lookaheadVideoTitleFromPool({ pool, assets: previewAssets, offset: 2 })).toBe("Item t2");
  });

  it("alternates the materialized week, and an insert does not move the rotation", () => {
    const insert = { ...ready(item("source_bumpers", "bumper", 1), 1) };
    const [day] = buildMaterializedProgrammingWeek({
      startDate: "2026-10-01",
      blocks: [{ ...block, durationMinutes: 300 }],
      pools: [
        {
          id: "pool_1",
          name: "TwitchYoutube",
          sourceIds: [TWITCH, YOUTUBE],
          cursorAssetId: "t1",
          sourceCursors: { [TWITCH]: "t1" },
          insertAssetId: "bumper",
          insertEveryItems: 2,
          itemsSinceInsert: 0
        }
      ],
      assets: [...previewAssets, insert]
    });
    expect(day?.blocks[0]?.items.slice(0, 8).map((entry) => entry.assetId)).toEqual([
      "y1",
      "t2",
      "bumper",
      "y2",
      "t3",
      "bumper",
      "y1",
      "t1"
    ]);
  });

  it("keeps the insert asset in the rotation while its cadence is 0, as the worker does", () => {
    const bumper = ready(item(YOUTUBE, "y0", 0), 1);
    const pool = { id: "pool_1", sourceIds: [YOUTUBE], cursorAssetId: "", insertAssetId: "y0", insertEveryItems: 0 };
    const preview = buildSchedulePreview({ date: "2026-10-01", blocks: [block], pools: [pool], assets: [bumper, ...previewAssets], maxVideoSlotsPerBlock: 3 });
    expect(preview.items[0]?.videoSlots.map((slot) => slot.assetId)).toEqual(["y0", "y1", "y2"]);
    const inserting = buildSchedulePreview({
      date: "2026-10-01",
      blocks: [block],
      pools: [{ ...pool, insertEveryItems: 3 }],
      assets: [bumper, ...previewAssets],
      maxVideoSlotsPerBlock: 3
    });
    expect(inserting.items[0]?.videoSlots.map((slot) => slot.assetId)).toEqual(["y1", "y2", "y1"]);
  });
});

// The worker module starts the playout on import, so its wiring is checked in its source.
describe("pool rotation wiring", () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
  const workerSource = read("apps/worker/src/index.ts");
  const coreSource = read("packages/core/src/index.ts");
  const bodyOf = (source: string, signature: string) => {
    const start = source.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    const rest = source.slice(start + signature.length);
    const end = rest.search(/\n(?:export )?(?:async )?function /);
    return source.slice(start, end === -1 ? undefined : start + signature.length + end);
  };

  it("selects and queues pool items through the rotation, with the worker's own eligibility", () => {
    const eligibility = bodyOf(workerSource, "function isPoolAssetEligible(");
    // The Remove next hold (M89) beside the skip hold.
    for (const rule of [
      "pool.insertEveryItems > 0",
      "pool.audioLaneAssetId",
      "asset.id !== skippedAssetId",
      "asset.id !== removedNextAssetId",
      "isAssetBlockedForAutomaticSelection(asset)"
    ]) {
      expect(eligibility).toContain(rule);
    }
    const select = bodyOf(workerSource, "function selectPoolAsset(");
    expect(select).toContain("nextPoolRotationAsset(");
    expect(select).toContain("isPoolAssetEligible(pool, asset, skippedAssetId, removedNextAssetId)");
    const queue = bodyOf(workerSource, "function getPoolPlaybackQueue(");
    expect(queue).toContain("walkPoolRotation(");
    expect(queue).toContain('isPoolAssetEligible(pool, asset, skippedAssetId, options.removedNextAssetId ?? "")');
    expect(queue).toContain("afterAssetId: options.currentStartsPool ? currentAssetId : \"\"");
    // The queue walks on from the selection only in the cycle that stores it, the cursor write's own test
    // (selectionTakesPoolPosition in playout-boundary.ts, with the M74 hand-over of a running insert).
    const flatWorker = workerSource.replace(/\s+/g, " ");
    expect(flatWorker).toContain(
      "const selectionTakesPosition = selectionTakesPoolPosition({ selectionReasonCode: selection.reasonCode, selectedAssetId: selection.asset?.id ?? \"\", runtimeCurrentAssetId: state.playout.currentAssetId, runtimeReasonCode: state.playout.selectionReasonCode });"
    );
    expect(flatWorker).toContain("currentStartsPool: selectionTakesPosition");
    const matchWrite = workerSource.indexOf("await updatePoolCursor(currentScheduleItem.poolId, selection.asset.id, {");
    expect(workerSource.slice(matchWrite - 400, matchWrite).replace(/\s+/g, " ")).toContain(
      "if (currentScheduleItem?.poolId && selectionTakesPosition && selection.asset) {"
    );
    // The head fallback that every Skip used to hit is gone.
    expect(workerSource).not.toContain("eligibleAssets[0]");
  });

  it("stores the started item's source position and leaves the rotation alone on an insert", () => {
    const matchWrite = workerSource.indexOf("await updatePoolCursor(currentScheduleItem.poolId, selection.asset.id, {");
    expect(matchWrite).toBeGreaterThan(-1);
    expect(workerSource.slice(matchWrite, matchWrite + 200)).toContain("sourceId: selection.asset.sourceId");
    const insertWrite = workerSource.indexOf("await updatePoolCursor(currentScheduleItem.poolId, null, {");
    expect(insertWrite).toBeGreaterThan(-1);
    expect(workerSource.slice(insertWrite, insertWrite + 120)).toContain("resetItemsSinceInsert: true");
    expect(workerSource.slice(insertWrite, insertWrite + 120)).not.toContain("sourceId");
    // The third write: a scheduled insert skipped once (M94, owner Q6) resets the counter like a started
    // one, and leaves the rotation alone too.
    const skipWrite = workerSource.indexOf("await updatePoolCursor(poolId, null, { resetItemsSinceInsert: true });");
    expect(skipWrite).toBeGreaterThan(-1);
    expect(workerSource.match(/await updatePoolCursor\(/g)?.length).toBe(3);
  });

  it("walks every core preview through the rotation", () => {
    expect(bodyOf(coreSource, "export function lookaheadVideoTitleFromPool(")).toContain("walkPoolRotation(");
    expect(bodyOf(coreSource, "export function buildSchedulePreviewVideoSlots(")).toContain("createPoolRotation(");
    expect(bodyOf(coreSource, "function materializePoolWindow(")).toContain("createPoolRotation(");
  });
});

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((entry, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [entry, ...rest])
  );
}
