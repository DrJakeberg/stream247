import { describe, expect, it } from "vitest";
import {
  SOURCE_BREAKER_BASE_COOLDOWN_SECONDS,
  SOURCE_BREAKER_FAILED_ITEM_THRESHOLD,
  SOURCE_BREAKER_MAX_COOLDOWN_SECONDS,
  closedSourceBreaker,
  describeSourceBreaker,
  nextSourceBreakerRecord,
  planSourceBreakerUpdates,
  sourceBreakerGate,
  sourceBreakerPhase,
  buildMaterializedProgrammingWeek,
  buildSchedulePreview,
  lookaheadVideoTitleFromPool,
  nextPoolRotationAsset,
  walkPoolRotation,
  type PoolRotationSourceGate,
  type ProgrammingOrderAsset,
  type SourceBreakerOutcome,
  type SourceBreakerRecord
} from "@stream247/core";

// M75. The DUT case of 2026-09-28: YouTube's SABR change, 0 of 11 items of the YouTube source resolvable.
const YOUTUBE = "source_youtube";
const TWITCH = "source_twitch";
const T0 = Date.parse("2026-09-28T10:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const failed = (assetId: string, sourceId = YOUTUBE, error = "Requested format is not available"): SourceBreakerOutcome => ({
  sourceId,
  assetId,
  outcome: "failed",
  error
});
const ok = (assetId: string, sourceId = YOUTUBE): SourceBreakerOutcome => ({ sourceId, assetId, outcome: "ok", error: "" });

function run(outcomes: Array<[SourceBreakerOutcome, string]>, start: SourceBreakerRecord = closedSourceBreaker(YOUTUBE)) {
  return outcomes.reduce((record, [outcome, nowIso]) => nextSourceBreakerRecord(record, outcome, nowIso), start);
}

function openedAt(minutes: number, cooldownSeconds = SOURCE_BREAKER_BASE_COOLDOWN_SECONDS): SourceBreakerRecord {
  return {
    sourceId: YOUTUBE,
    state: "open",
    failedAssetIds: ["y1", "y2", "y3"],
    openedAt: at(minutes),
    cooldownSeconds,
    lastError: "Requested format is not available",
    updatedAt: at(minutes)
  };
}

describe("source circuit breaker", () => {
  it.each([
    ["one item failing again and again (quarantine's case, not the source's)", [failed("y1"), failed("y1"), failed("y1"), failed("y1")], "closed", ["y1"]],
    ["two distinct items", [failed("y1"), failed("y2"), failed("y2")], "closed", ["y1", "y2"]],
    ["three distinct items", [failed("y1"), failed("y2"), failed("y3")], "open", ["y1", "y2", "y3"]],
    ["a repeat between distinct items", [failed("y1"), failed("y1"), failed("y2"), failed("y3")], "open", ["y1", "y2", "y3"]],
    ["a clean probe in between", [failed("y1"), failed("y2"), ok("y4"), failed("y3")], "closed", ["y3"]],
    ["a clean probe of the very item that failed", [failed("y1"), ok("y1"), failed("y2"), failed("y3")], "closed", ["y2", "y3"]]
  ])("counts distinct failed items with no clean probe between: %s", (_label, outcomes, state, failedIds) => {
    const record = run(outcomes.map((outcome, index) => [outcome, at(index)] as [SourceBreakerOutcome, string]));
    expect(record.state).toBe(state);
    expect(record.failedAssetIds).toEqual(failedIds);
    expect(SOURCE_BREAKER_FAILED_ITEM_THRESHOLD).toBe(3);
  });

  it("opens for the base cooldown of 30 minutes with the error that opened it", () => {
    const record = run([
      [failed("y1"), at(0)],
      [failed("y2"), at(1)],
      [failed("y3", YOUTUBE, "Sign in to confirm you are not a bot"), at(2)]
    ]);
    expect(record).toMatchObject({ state: "open", openedAt: at(2), cooldownSeconds: 30 * 60, lastError: "Sign in to confirm you are not a bot" });
    expect(sourceBreakerPhase(record, Date.parse(at(2)))).toBe("open");
    expect(sourceBreakerPhase(record, Date.parse(at(31)) - 1)).toBe("open");
    expect(sourceBreakerPhase(record, Date.parse(at(32)))).toBe("half-open");
  });

  it("ignores outcomes while the cooldown runs: a resolve that started before it opened proves nothing", () => {
    const open = openedAt(0);
    expect(nextSourceBreakerRecord(open, ok("y9"), at(5))).toBe(open);
    expect(nextSourceBreakerRecord(open, failed("y9"), at(5))).toBe(open);
  });

  it("closes on a clean trial probe and forgets the cooldown", () => {
    const closed = nextSourceBreakerRecord(openedAt(0, 4 * 3600), ok("y4"), at(4 * 60));
    expect(closed).toEqual(closedSourceBreaker(YOUTUBE, at(4 * 60)));
    // The next opening starts again at the base cooldown.
    const reopened = run([[failed("y5"), at(300)], [failed("y6"), at(301)], [failed("y7"), at(302)]], closed);
    expect(reopened.cooldownSeconds).toBe(SOURCE_BREAKER_BASE_COOLDOWN_SECONDS);
  });

  it("re-opens a failed trial with the cooldown doubled, up to the 6 h cap", () => {
    let record = openedAt(0);
    let minutes = 0;
    const cooldowns: number[] = [];
    for (let trial = 0; trial < 6; trial += 1) {
      minutes += record.cooldownSeconds / 60;
      expect(sourceBreakerPhase(record, Date.parse(at(minutes)))).toBe("half-open");
      record = nextSourceBreakerRecord(record, failed(`y${trial + 4}`), at(minutes));
      expect(record.state).toBe("open");
      expect(record.openedAt).toBe(at(minutes));
      cooldowns.push(record.cooldownSeconds / 60);
    }
    expect(cooldowns).toEqual([60, 120, 240, 360, 360, 360]);
    expect(SOURCE_BREAKER_MAX_COOLDOWN_SECONDS).toBe(6 * 3600);
  });

  it("decides on the first trial outcome only; later ones of the same scan meet the new state", () => {
    const plan = planSourceBreakerUpdates([openedAt(0)], [failed("y4"), ok("y5"), failed("y6")], at(30));
    expect(plan.transitions.map((transition) => transition.kind)).toEqual(["reopened"]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ state: "open", openedAt: at(30), cooldownSeconds: 3600 });

    const closing = planSourceBreakerUpdates([openedAt(0)], [ok("y4"), failed("y5")], at(30));
    expect(closing.transitions.map((transition) => transition.kind)).toEqual(["closed"]);
    expect(closing.updates[0]).toMatchObject({ state: "closed", failedAssetIds: ["y5"] });
  });

  it("plans per source in scan order and stores only what changed", () => {
    const plan = planSourceBreakerUpdates(
      [],
      [failed("y1"), ok("t1", TWITCH), failed("y2"), ok("t2", TWITCH), failed("y3")],
      at(0)
    );
    // A clean probe of Twitch does not clear YouTube's count, and a healthy source writes nothing.
    expect(plan.updates.map((record) => record.sourceId)).toEqual([YOUTUBE]);
    expect(plan.transitions).toEqual([{ sourceId: YOUTUBE, kind: "opened", record: plan.updates[0] }]);
    expect(planSourceBreakerUpdates([], [ok("t1", TWITCH)], at(0)).updates).toEqual([]);
  });

  // M75 review: the distinct-items rule is no outage guard for a pool with one source. Its queue holds
  // four items of that source, and an outage longer than the five-minute probe cache re-probes them all.
  // Pinned so the limit stays documented: it costs one cooldown and closes without the operator.
  it("opens on an outage that fails three items of a single-source queue, and closes on the first clean trial after it", () => {
    const dns = "Unable to download API page: <urlopen error [Errno -3] Temporary failure in name resolution>";
    let records: SourceBreakerRecord[] = [];
    ["y1", "y2", "y3", "y4"].forEach((assetId, index) => {
      const plan = planSourceBreakerUpdates(records, [failed(assetId, YOUTUBE, dns)], at(index * 2));
      records = plan.updates.length > 0 ? plan.updates : records;
    });
    expect(records[0]).toMatchObject({ state: "open", openedAt: at(4), failedAssetIds: ["y1", "y2", "y3"] });
    // A clean probe of an item of the same source (a cached archive) during the outage would have reset it.
    expect(run([[failed("y1"), at(0)], [ok("y2"), at(2)], [failed("y3"), at(4)], [failed("y4"), at(6)]]).state).toBe("closed");
    const trial = planSourceBreakerUpdates(records, [ok("y5")], at(4 + 30));
    expect(trial.transitions.map((transition) => transition.kind)).toEqual(["closed"]);
  });

  it("keeps the stored list and the error bounded", () => {
    let record = openedAt(0);
    for (let trial = 0; trial < 30; trial += 1) {
      record = nextSourceBreakerRecord(record, failed(`y${trial + 10}`, YOUTUBE, "x".repeat(800)), at(10_000 * (trial + 1)));
    }
    expect(record.failedAssetIds).toHaveLength(20);
    expect(record.failedAssetIds.at(-1)).toBe("y39");
    expect(record.lastError).toHaveLength(500);
  });

  it("treats an unreadable opening time as a cooldown that has run out, never as a source held forever", () => {
    expect(sourceBreakerPhase({ ...openedAt(0), openedAt: "garbage" }, T0)).toBe("half-open");
    expect(sourceBreakerPhase(undefined, T0)).toBe("closed");
  });

  it("gates the rotation: open sources held, half-open sources on trial, closed ones untouched", () => {
    const records = [openedAt(0), { ...openedAt(-40), sourceId: TWITCH }, closedSourceBreaker("source_local")];
    expect(sourceBreakerGate(records, Date.parse(at(10)))).toEqual({ heldSourceIds: [YOUTUBE], trialSourceIds: [TWITCH] });
    expect(sourceBreakerGate(undefined, T0)).toEqual({ heldSourceIds: [], trialSourceIds: [] });
  });

  it("describes an open breaker for the source page and nothing for a closed one", () => {
    expect(describeSourceBreaker(closedSourceBreaker(YOUTUBE), T0)).toBeNull();
    expect(describeSourceBreaker(openedAt(0), Date.parse(at(10)))).toEqual({
      phase: "open",
      openedAt: at(0),
      retryAt: at(30),
      cooldownSeconds: 1800,
      failedItemCount: 3,
      lastError: "Requested format is not available"
    });
    expect(describeSourceBreaker(openedAt(0), Date.parse(at(45)))?.phase).toBe("half-open");
  });
});

describe("the breaker in the pool rotation", () => {
  // The DUT pool "TwitchYoutube": Twitch first, YouTube second (M73).
  const item = (sourceId: string, id: string, day: number): ProgrammingOrderAsset => ({
    id,
    sourceId,
    title: `Item ${id}`,
    createdAt: new Date(Date.UTC(2026, 8, day)).toISOString()
  });
  const assets = [
    item(TWITCH, "t1", 1),
    item(TWITCH, "t2", 2),
    item(TWITCH, "t3", 3),
    item(YOUTUBE, "y1", 1),
    item(YOUTUBE, "y2", 2),
    item(YOUTUBE, "y3", 3)
  ];
  const pool = { sourceIds: [TWITCH, YOUTUBE], cursorAssetId: "t1", sourceCursors: { [TWITCH]: "t1" } };
  const gate = (heldSourceIds: string[], trialSourceIds: string[] = []): PoolRotationSourceGate => ({ heldSourceIds, trialSourceIds });
  const walk = (sourceGate: PoolRotationSourceGate | null, steps = 6, afterAssetId = "") =>
    walkPoolRotation({ pool, assets, isEligible: () => true, sourceGate, steps, afterAssetId }).map((pick) => pick.asset.id);

  it("leaves the rotation exactly as it was without an open breaker", () => {
    expect(walk(null)).toEqual(["y1", "t2", "y2", "t3", "y3", "t1"]);
    expect(walk(gate([]))).toEqual(walk(null));
  });

  it("skips an open source and keeps alternating the others", () => {
    expect(walk(gate([YOUTUBE]))).toEqual(["t2", "t3", "t1", "t2", "t3", "t1"]);
    const three = { ...pool, sourceIds: [TWITCH, YOUTUBE, "source_local"] };
    const withLocal = [...assets, item("source_local", "l1", 1), item("source_local", "l2", 2)];
    expect(
      walkPoolRotation({ pool: three, assets: withLocal, isEligible: () => true, sourceGate: gate([YOUTUBE]), steps: 4 }).map(
        (pick) => pick.asset.id
      )
    ).toEqual(["l1", "t2", "l2", "t3"]);
  });

  it("lets a half-open source give one item per walk, its trial, where its position stands", () => {
    expect(walk(gate([], [YOUTUBE]))).toEqual(["y1", "t2", "t3", "t1", "t2", "t3"]);
    const later = { ...pool, sourceCursors: { [TWITCH]: "t1", [YOUTUBE]: "y2" } };
    expect(
      walkPoolRotation({ pool: later, assets, isEligible: () => true, sourceGate: gate([], [YOUTUBE]), steps: 4 }).map(
        (pick) => pick.asset.id
      )
    ).toEqual(["y3", "t2", "t3", "t1"]);
  });

  it("counts the selection this cycle starts as the trial, so its queue holds no second item of the source", () => {
    expect(walk(gate([], [YOUTUBE]), 4, "y1")).toEqual(["t2", "t3", "t1", "t2"]);
  });

  it("picks the trial item as a single pick, and nothing of a held source", () => {
    expect(nextPoolRotationAsset({ pool, assets, isEligible: () => true, sourceGate: gate([], [YOUTUBE]) })?.asset.id).toBe("y1");
    expect(nextPoolRotationAsset({ pool, assets, isEligible: () => true, sourceGate: gate([YOUTUBE]) })?.asset.id).toBe("t2");
  });

  it("finds nothing when every source of the pool is held, which hands the block to the fallback as today", () => {
    expect(nextPoolRotationAsset({ pool, assets, isEligible: () => true, sourceGate: gate([TWITCH, YOUTUBE]) })).toBeNull();
  });

  it("shows the gated pick in the lookahead and the materialized week", () => {
    const previewAssets = assets.map((asset) => ({ ...asset, status: "ready", includeInProgramming: true }));
    const previewPool = { ...pool, id: "pool_ty", name: "TwitchYoutube", insertAssetId: "", insertEveryItems: 0, itemsSinceInsert: 0 };
    expect(lookaheadVideoTitleFromPool({ pool: previewPool, assets: previewAssets })).toBe("Item y1");
    expect(lookaheadVideoTitleFromPool({ pool: previewPool, assets: previewAssets, sourceGate: gate([YOUTUBE]) })).toBe("Item t2");

    const week = buildMaterializedProgrammingWeek({
      startDate: "2026-09-28",
      blocks: [
        {
          id: "block_1",
          title: "TwitchYoutube",
          categoryName: "",
          dayOfWeek: 1,
          startMinuteOfDay: 600,
          durationMinutes: 60,
          poolId: "pool_ty",
          sourceName: ""
        }
      ],
      pools: [previewPool],
      assets: previewAssets.map((asset) => ({ ...asset, durationSeconds: 600 })),
      sourceGate: gate([YOUTUBE])
    });
    const block = week.flatMap((day) => day.blocks)[0];
    expect(block?.items.map((entry) => entry.assetId).slice(0, 4)).toEqual(["t2", "t3", "t1", "t2"]);
    expect(block?.notes.join(" ")).toContain("held out after failed probes");
  });

  // M75 review: no test held the gate in the slot preview, and a pool held whole was reported as a pool
  // without ready assets.
  const previewAssets = assets.map((asset) => ({ ...asset, status: "ready", includeInProgramming: true, durationSeconds: 600 }));
  const previewPool = { ...pool, id: "pool_ty", name: "TwitchYoutube", insertAssetId: "", insertEveryItems: 0, itemsSinceInsert: 0 };
  const block = {
    id: "block_1",
    title: "TwitchYoutube",
    categoryName: "",
    dayOfWeek: 1,
    startMinuteOfDay: 600,
    durationMinutes: 60,
    poolId: "pool_ty",
    sourceName: ""
  };
  const weekNotes = (weekAssets: typeof previewAssets, sourceGate: PoolRotationSourceGate) =>
    buildMaterializedProgrammingWeek({ startDate: "2026-09-28", blocks: [block], pools: [previewPool], assets: weekAssets, sourceGate })
      .flatMap((day) => day.blocks)[0]?.notes.join(" ") ?? "";

  it("leaves a held source out of the schedule preview's video slots", () => {
    const slots = (sourceGate: PoolRotationSourceGate | null) =>
      buildSchedulePreview({ date: "2026-09-28", blocks: [block], pools: [previewPool], assets: previewAssets, maxVideoSlotsPerBlock: 4, sourceGate })
        .items[0]?.videoSlots.map((slot) => slot.assetId);
    expect(slots(null)).toEqual(["y1", "t2", "y2", "t3"]);
    expect(slots(gate([YOUTUBE]))).toEqual(["t2", "t3", "t1", "t2"]);
    expect(slots(gate([TWITCH, YOUTUBE]))).toEqual([]);
  });

  it("says a pool is held, not that it has no ready assets, when the breaker is the only reason", () => {
    const heldWhole = weekNotes(previewAssets, gate([TWITCH, YOUTUBE]));
    expect(heldWhole).toContain("Every source of this pool with ready assets is held out after failed probes");
    expect(heldWhole).not.toContain("no ready programming assets");
    // Nothing ready at all: that is the reason, whatever the breaker says.
    const nothingReady = weekNotes(previewAssets.map((asset) => ({ ...asset, status: "pending" })), gate([YOUTUBE]));
    expect(nothingReady).toContain("The selected pool has no ready programming assets.");
    expect(nothingReady).not.toContain("held out");
  });
});
