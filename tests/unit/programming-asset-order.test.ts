import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSchedulePreview,
  compareProgrammingAssets,
  parseNumericVodId,
  sortProgrammingAssets,
  type ProgrammingOrderAsset
} from "@stream247/core";

// M72. The DUT state on 2026-10-01: one created_at per source (each sync rewrote it), no published_at,
// so these tiebreaks are what actually decides the order until the stored dates settle.
const sameSyncStamp = "2026-10-01T09:15:00.000Z";

function asset(overrides: Partial<ProgrammingOrderAsset> & { id: string }): ProgrammingOrderAsset {
  return { sourceId: "source_twitch", title: "Stream", createdAt: sameSyncStamp, ...overrides };
}

function order(assets: ProgrammingOrderAsset[]): string[] {
  return sortProgrammingAssets(assets).map((entry) => entry.id);
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest])
  );
}

describe("programming asset order", () => {
  it("puts the older date first, published date before first-seen date", () => {
    expect(
      order([
        asset({ id: "late", publishedAt: "2026-08-01T00:00:00.000Z" }),
        asset({ id: "first-seen-early", createdAt: "2026-06-01T00:00:00.000Z" }),
        asset({ id: "early", publishedAt: "2026-07-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" })
      ])
    ).toEqual(["first-seen-early", "early", "late"]);
  });

  it("sorts an unparsable date last instead of letting NaN scramble the order", () => {
    expect(order([asset({ id: "broken", createdAt: "not a date" }), asset({ id: "dated" })])).toEqual(["dated", "broken"]);
  });

  it("orders one source's Twitch archives by numeric VOD id, digit strings rather than Number", () => {
    expect(
      order([
        asset({ id: "a", externalId: "2581000000", title: "Alpha" }),
        asset({ id: "b", externalId: "999999999", title: "Zulu" }),
        asset({ id: "c", externalId: "v2887855611", title: "Alpha" })
      ])
    ).toEqual(["b", "a", "c"]);
    // 20 digits: beyond Number's exact range, still ordered.
    expect(
      compareProgrammingAssets(
        asset({ id: "x", externalId: "12345678901234567891" }),
        asset({ id: "y", externalId: "12345678901234567890" })
      )
    ).toBeGreaterThan(0);
  });

  it("never compares ids or titles across sources: equal dates group by source", () => {
    // Both the id ("1") and the title would put the other channel first; the source id decides.
    const fromOtherChannel = asset({ id: "other", sourceId: "source_twitch_b", externalId: "1", title: "Alpha" });
    const fromThisChannel = asset({ id: "this", externalId: "2887855611", title: "Zulu" });
    expect(order([fromOtherChannel, fromThisChannel])).toEqual(["this", "other"]);
    expect(order([fromThisChannel, fromOtherChannel])).toEqual(["this", "other"]);
  });

  it("falls to the title when ids are not both numeric, then to the asset id", () => {
    expect(
      order([
        asset({ id: "yt-b", sourceId: "source_youtube", externalId: "dQw4w9WgXcQ", title: "Bravo" }),
        asset({ id: "yt-a", sourceId: "source_youtube", externalId: "cSabcTQLLoE", title: "Alpha" })
      ])
    ).toEqual(["yt-a", "yt-b"]);
    expect(order([asset({ id: "asset_2", title: "Same" }), asset({ id: "asset_1", title: "Same" })])).toEqual(["asset_1", "asset_2"]);
  });

  it("is deterministic whatever order the database returned the rows in", () => {
    const rows = [
      asset({ id: "t1", externalId: "100" }),
      asset({ id: "t2", externalId: "99" }),
      asset({ id: "s1", title: "Same" }),
      asset({ id: "s0", title: "Same" }),
      asset({ id: "p", publishedAt: "2026-01-01T00:00:00.000Z" })
    ];
    const expected = order(rows);
    expect(order(rows.slice().reverse())).toEqual(expected);
    expect(expected).toEqual(["p", "t2", "t1", "s0", "s1"]);
  });

  // Review finding on the first draft: ids compared only for same-source pairs and titles for the rest
  // made a cycle (A < B by id, B < C by title, C < A by title), and the six input orders of those three
  // gave three different results. Two Twitch channels synced in one pass share one createdAt, and the
  // input is `ORDER BY updated_at DESC`, which every sync and cache peek reshuffles.
  it("gives one order for every input order of two same-date Twitch channels with crossing titles", () => {
    const rows = [
      asset({ id: "a", sourceId: "source_twitch_1", externalId: "1000000001", title: "Zebra" }),
      asset({ id: "b", sourceId: "source_twitch_1", externalId: "1000000002", title: "Apple" }),
      asset({ id: "c", sourceId: "source_twitch_2", externalId: "1000000003", title: "Mango" }),
      asset({ id: "d", sourceId: "source_twitch_2", externalId: "v999999999", title: "Kiwi" }),
      asset({ id: "e", sourceId: "source_twitch_1", externalId: "2880000006", title: "Banana" })
    ];
    const results = new Set(permutations(rows).map((input) => order(input).join(",")));
    expect([...results]).toEqual(["a,b,e,d,c"]);
  });

  it("gives one order for a source that mixes numeric and missing ids", () => {
    const rows = [
      asset({ id: "a", externalId: "200", title: "Alpha" }),
      asset({ id: "b", externalId: "100", title: "Zulu" }),
      asset({ id: "d", externalId: "", title: "Mango" }),
      asset({ id: "f", title: "Bravo" })
    ];
    const results = new Set(permutations(rows).map((input) => order(input).join(",")));
    expect([...results]).toEqual(["b,a,f,d"]);
  });

  it("reads the VOD id with or without its v", () => {
    expect(parseNumericVodId("v2887855611")).toBe("2887855611");
    expect(parseNumericVodId("2887855611")).toBe("2887855611");
    expect(parseNumericVodId("007")).toBe("7");
    expect(parseNumericVodId("cSabcTQLLoE")).toBeNull();
    expect(parseNumericVodId(undefined)).toBeNull();
  });

  it("drives the schedule preview's video slots", () => {
    const preview = buildSchedulePreview({
      date: "2026-10-01",
      blocks: [
        { id: "block_1", title: "Archive", categoryName: "Replay", dayOfWeek: 4, startMinuteOfDay: 600, durationMinutes: 600, poolId: "pool_1", sourceName: "Pool" }
      ],
      pools: [{ id: "pool_1", sourceIds: ["source_twitch"], cursorAssetId: "" }],
      assets: [
        { id: "late", sourceId: "source_twitch", title: "A", externalId: "2887855611", status: "ready", includeInProgramming: true, durationSeconds: 3600, createdAt: sameSyncStamp },
        { id: "early", sourceId: "source_twitch", title: "Z", externalId: "999999999", status: "ready", includeInProgramming: true, durationSeconds: 3600, createdAt: sameSyncStamp }
      ]
    });
    expect(preview.items[0]?.videoSlots.slice(0, 2).map((slot) => slot.assetId)).toEqual(["early", "late"]);
  });
});

describe("programming asset order wiring", () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
  const coreSource = read("packages/core/src/index.ts");
  const workerSource = read("apps/worker/src/index.ts");
  const recoverySource = read("apps/worker/src/playout-recovery.ts");
  const handCopiedKey = "new Date(left.publishedAt || left.createdAt)";

  it("has no hand-copied sort left in core, worker selection or recovery", () => {
    expect(coreSource).not.toContain(handCopiedKey);
    expect(workerSource).not.toContain(handCopiedKey);
    expect(recoverySource).not.toContain(handCopiedKey);
  });

  it("sorts preview and materialized windows with the shared order", () => {
    expect(coreSource.match(/sortProgrammingAssets\(/g)?.length).toBe(2);
  });

  it("sorts the worker's pool selection with the shared comparator", () => {
    const start = workerSource.indexOf("function getPoolEligibleAssets(");
    const body = workerSource.slice(start, workerSource.indexOf("\nfunction ", start + 1));
    expect(body).toContain(".sort(compareProgrammingAssets)");
  });

  it("keeps fallback priority first in recovery and hands the tail to the shared comparator", () => {
    const start = recoverySource.indexOf("function compareRecoveryCandidates(");
    const body = recoverySource.slice(start);
    expect(body.indexOf("left.fallbackPriority - right.fallbackPriority")).toBeGreaterThan(-1);
    expect(body.indexOf("compareProgrammingAssets(left, right)")).toBeGreaterThan(
      body.indexOf("left.fallbackPriority - right.fallbackPriority")
    );
  });
});
