import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCuepointKey,
  buildMaterializedProgrammingWeek,
  buildScheduleOccurrences,
  findCurrentScheduleOccurrence,
  resolveBlockCuepointAssetId,
  type ScheduleBlock
} from "@stream247/core";
import type { AppState, AssetRecord } from "@stream247/db";
import { getCuepointInsertPlan, getCuepointWarmAsset } from "../../apps/worker/src/cuepoints";
import {
  decideInputOpenRetry,
  decideInputOpenRetryAfterExit,
  INPUT_OPEN_RETRY_WINDOW_MS,
  isCurrentItemSlotFree,
  type InputOpenRetryState
} from "../../apps/worker/src/input-open-retry";
import { classifyIncidentFingerprint } from "../../apps/worker/src/incident-classes";
import { decideScheduledInsertSkip, describeSkippedInsert, isPoolIntervalInsertDueNext } from "../../apps/worker/src/scheduled-insert";

// M94. A YouTube or Twitch insert airs, or is skipped once with an incident, never retried forever
// (planning/research/robustness.md W1, W5, W6; owner decision Q6).

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
const flat = workerSource.replace(/\s+/g, " ");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(-1);
  return source.slice(from, to + end.length);
}

// 2026-04-05 is a Sunday. One block 10:00-11:00 with cuepoints at 10 and 30 minutes; the pool names a
// YouTube sting as its insert with the cadence at 0, so the cuepoints fall back to it.
const DATE = "2026-04-05";
const block: ScheduleBlock = {
  id: "block-1",
  title: "Prime Replay",
  categoryName: "Gaming",
  dayOfWeek: 0,
  startMinuteOfDay: 600,
  durationMinutes: 60,
  sourceName: "Replay Pool",
  poolId: "pool-1",
  cuepointAssetId: "",
  cuepointOffsetsSeconds: [600, 1800]
};
const pool = {
  id: "pool-1",
  name: "Replay Pool",
  sourceIds: ["source-1", "source-yt"],
  playbackMode: "round-robin" as const,
  cursorAssetId: "",
  insertAssetId: "asset-sting",
  insertEveryItems: 0,
  audioLaneAssetId: "",
  audioLaneVolumePercent: 100,
  itemsSinceInsert: 0,
  updatedAt: ""
};
const asset = (id: string, sourceId: string, durationSeconds: number, extra: Partial<AssetRecord> = {}): AssetRecord =>
  ({
    id,
    sourceId,
    title: id,
    path: sourceId === "source-yt" ? `https://www.youtube.com/watch?v=${id}` : `/media/${id}.mp4`,
    status: "ready",
    includeInProgramming: true,
    externalId: "",
    categoryName: "",
    durationSeconds,
    publishedAt: "",
    fallbackPriority: 100,
    isGlobalFallback: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "",
    ...extra
  }) as AssetRecord;
const sting = asset("asset-sting", "source-yt", 30);
const episode = asset("asset-episode", "source-1", 600);

function stateWith(overrides: { assets?: AssetRecord[]; playout?: Partial<AppState["playout"]>; pool?: Partial<typeof pool> } = {}): AppState {
  return {
    managedConfig: {},
    scheduleBlocks: [block],
    pools: [{ ...pool, ...overrides.pool }],
    assets: overrides.assets ?? [episode, sting],
    playout: { cuepointWindowKey: "", cuepointFiredKeys: [], ...overrides.playout }
  } as unknown as AppState;
}

const current = findCurrentScheduleOccurrence({ occurrences: buildScheduleOccurrences({ date: DATE, blocks: [block] }), currentTime: "10:00" })!;
const at = (time: string) => new Date(`${DATE}T${time}:00.000Z`);

describe("W5: one cuepoint item for worker, week view and live view", () => {
  it("falls back to the pool's insert whatever the cadence is", () => {
    expect(resolveBlockCuepointAssetId(block, pool)).toBe("asset-sting");
    expect(resolveBlockCuepointAssetId({ ...block, cuepointAssetId: "own" }, pool)).toBe("own");
    expect(resolveBlockCuepointAssetId(block, { ...pool, insertAssetId: "" })).toBe("");
    expect(resolveBlockCuepointAssetId(null, null)).toBe("");
  });

  it("insertEveryItems 0 with a pool insert asset: the week view counts as many cuepoint inserts as the worker fires", () => {
    // The worker: one cycle a minute through the block, each fired cuepoint stored as the cycle end does.
    let fired: string[] = [];
    let workerCount = 0;
    for (let minute = 0; minute < 60; minute += 1) {
      const time = `10:${String(minute).padStart(2, "0")}`;
      const plan = getCuepointInsertPlan({
        state: stateWith({ playout: { cuepointWindowKey: current.key, cuepointFiredKeys: fired } }),
        currentScheduleItem: { ...current, poolId: "pool-1" },
        skippedAssetId: "",
        now: at(time),
        timeZone: "UTC"
      });
      if (plan) {
        workerCount += 1;
        fired = [...fired, plan.cuepointKey];
      }
    }

    const [sunday] = buildMaterializedProgrammingWeek({
      startDate: DATE,
      blocks: [block],
      pools: [pool],
      assets: [episode, sting]
    });
    const previewBlock = sunday!.blocks[0]!;
    expect(workerCount).toBe(2);
    // Before M94 the week view gave 0 here and listed the sting as an ordinary item only.
    expect(previewBlock.cuepointCount).toBe(workerCount);
    expect(previewBlock.items.filter((item) => item.insertTrigger === "cuepoint").map((item) => item.assetId)).toEqual([
      "asset-sting",
      "asset-sting"
    ]);
  });

  it("the live view takes the cuepoint item from the same helper", () => {
    const web = readFileSync(path.join(process.cwd(), "apps/web/lib/server/state.ts"), "utf8");
    expect(web).toContain("const cuepointAssetId = resolveBlockCuepointAssetId(block, pool);");
    const cuepoints = readFileSync(path.join(process.cwd(), "apps/worker/src/cuepoints.ts"), "utf8");
    expect(cuepoints).toContain("const cuepointAssetId = resolveBlockCuepointAssetId(block, pool);");
    expect(cuepoints).not.toContain("pool.insertAssetId ||");
  });
});

// R3's W1 probe (failing-pool-insert, three cases) as tests: the insert is warmed, a bridged or failed
// insert is used up, and the insert checks apply quarantine and breaker.
describe("W1: a remote insert is warmed before it is due", () => {
  it.each([
    ["cadence 3, two items since, the cycle starts the third: due next", 2, 3, true, false, true],
    ["cadence 3, three since, an item running: due next", 3, 3, false, false, true],
    ["cadence 3, one since: not yet", 1, 3, true, false, false],
    ["the cycle starts the insert itself: its counter resets", 3, 3, false, true, false],
    ["cadence 0: no interval insert", 9, 0, true, false, false]
  ])("%s", (_case, itemsSinceInsert, insertEveryItems, selectionTakesPosition, selectionIsScheduledInsert, expected) => {
    expect(
      isPoolIntervalInsertDueNext({
        insertAssetId: "asset-sting",
        insertEveryItems,
        itemsSinceInsert,
        selectionTakesPosition,
        selectionIsScheduledInsert
      })
    ).toBe(expected);
  });

  const warmAt = (time: string, playout: Partial<AppState["playout"]> = {}, assets?: AssetRecord[], isAssetBlocked?: (a: AssetRecord) => boolean) =>
    getCuepointWarmAsset({
      state: stateWith({ playout, assets }),
      currentScheduleItem: { ...current, poolId: "pool-1" },
      skippedAssetId: "",
      isAssetBlocked,
      now: at(time),
      timeZone: "UTC",
      lookaheadSeconds: 300
    })?.id ?? null;

  it("warms the cuepoint item within the probe lifetime before the cuepoint, and while it is due", () => {
    expect(warmAt("10:02")).toBeNull();
    expect(warmAt("10:05")).toBe("asset-sting");
    expect(warmAt("10:12")).toBe("asset-sting");
    // Fired: nothing until the next one comes near.
    const fired = { cuepointWindowKey: current.key, cuepointFiredKeys: [buildCuepointKey(current.key, 600)] };
    expect(warmAt("10:12", fired)).toBeNull();
    expect(warmAt("10:26", fired)).toBe("asset-sting");
  });

  it("does not warm an item the insert checks refuse", () => {
    expect(warmAt("10:12", {}, [episode, { ...sting, playbackProbeFailures: 3 } as AssetRecord], () => true)).toBeNull();
  });

  it("the queue scan warms it ahead of the pool's items, with their budget, without making it the queue", () => {
    expect(flat).toContain(
      "warmOnly: poolQueueScanned ? planScheduledInsertWarm({ state, currentScheduleItem, selection, selectionTakesPosition }) : []"
    );
    const scan = between(workerSource, "async function getPlayableQueuedAssets(", "\nfunction buildAssetQueueSubtitle(");
    expect(scan).toContain("const queueAssets = [...warmOnly, ...poolQueueAssets];");
    // Five places that would make it the queue, the prefetched item or the queue's status.
    expect(scan.match(/isWarmOnly\(index\)/g)?.length).toBe(5);
    const plan = between(workerSource, "function planScheduledInsertWarm(", "\n}\n");
    expect(plan).toContain("isAssetBlocked: isInsertBlocked");
    expect(plan).toContain("lookaheadSeconds: NEXT_ASSET_PROBE_READY_TTL_MS / 1000");
    expect(plan).toContain("!isInsertBlocked(asset)");
  });
});

describe("W1: a bridged or failed insert is skipped once and counts as played (owner Q6)", () => {
  const runKey = current.key;

  it("uses up the pool's counter for an interval insert", () => {
    expect(
      decideScheduledInsertSkip({ trigger: "pool-interval", cuepointKey: "", runKey, playout: { cuepointWindowKey: "", cuepointFiredKeys: [] } })
    ).toEqual({ resetItemsSinceInsert: true, cuepoint: null });
  });

  it("fires the cuepoint, so the same cuepoint is not due at the next boundary", () => {
    const key = buildCuepointKey(runKey, 600);
    const skip = decideScheduledInsertSkip({
      trigger: "cuepoint",
      cuepointKey: key,
      runKey,
      playout: { cuepointWindowKey: "an-earlier-run", cuepointFiredKeys: ["old"] }
    });
    expect(skip).toEqual({ resetItemsSinceInsert: false, cuepoint: { cuepointWindowKey: runKey, cuepointFiredKeys: [key] } });

    const planAt = (playout: Partial<AppState["playout"]>, time: string) =>
      getCuepointInsertPlan({
        state: stateWith({ playout }),
        currentScheduleItem: { ...current, poolId: "pool-1" },
        skippedAssetId: "",
        now: at(time),
        timeZone: "UTC"
      });
    // The probe's reproduction: without the write the cuepoint stays due at every boundary.
    expect(planAt({}, "10:15")?.cuepointKey).toBe(key);
    expect(planAt(skip.cuepoint!, "10:15")).toBeNull();
    // The next cuepoint still arms.
    expect(planAt(skip.cuepoint!, "10:31")?.cuepointKey).toBe(buildCuepointKey(runKey, 1800));
  });

  it("keeps cuepoints already fired in the same run, and changes nothing without a trigger", () => {
    const first = buildCuepointKey(runKey, 600);
    const second = buildCuepointKey(runKey, 1800);
    expect(
      decideScheduledInsertSkip({ trigger: "cuepoint", cuepointKey: second, runKey, playout: { cuepointWindowKey: runKey, cuepointFiredKeys: [first] } })
        .cuepoint?.cuepointFiredKeys
    ).toEqual([first, second]);
    expect(decideScheduledInsertSkip({ trigger: "", cuepointKey: "", runKey, playout: { cuepointWindowKey: "", cuepointFiredKeys: [] } })).toEqual({
      resetItemsSinceInsert: false,
      cuepoint: null
    });
  });

  it("names the insert in the incident", () => {
    const bridged = describeSkippedInsert({ title: "YouTube Sting", trigger: "cuepoint", reason: "bridged" });
    expect(bridged).toContain("Cuepoint insert YouTube Sting");
    expect(bridged).toContain("skipped once and counted as played");
    const failed = describeSkippedInsert({ title: "Twitch Clip", trigger: "pool-interval", reason: "prepare-failed", error: "HTTP Error 403" });
    expect(failed).toContain("Pool insert Twitch Clip could not be prepared (HTTP Error 403)");
    expect(describeSkippedInsert({ title: "Sting", trigger: "pool-interval", reason: "start-failed", error: "spawn ENOENT" })).toContain(
      "Pool insert Sting could not be started (spawn ENOENT)"
    );
  });

  it("is an event incident the playout area closes once it is healthy", () => {
    expect(classifyIncidentFingerprint("playout.insert.skipped")).toMatchObject({ kind: "event", area: "playout", keyed: false });
  });

  it("the boundary skips a scheduled insert it bridges and one that fails to prepare", () => {
    const attemptOf = between(workerSource, "function scheduledInsertAttemptOf(", "\n}\n").replace(/\s+/g, " ");
    expect(attemptOf).toContain(
      'selection.reasonCode === "scheduled_insert" && selection.asset && (selection.insertTrigger === "pool-interval" || selection.insertTrigger === "cuepoint")'
    );
    expect(flat).toContain("const scheduledInsertAttempt = scheduledInsertAttemptOf(selection);");
    expect(flat).toContain('state = await skipScheduledInsert({ state, attempt: scheduledInsertAttempt, reason: "bridged", now: scheduleNow });');
    // A failure while the bridge itself is resolved is the bridge's: the insert counts as bridged.
    expect(flat).toContain(
      'state = await skipScheduledInsert( bridgingInsert ? { state, attempt: scheduledInsertAttempt, reason: "bridged", now: scheduleNow } : { state, attempt: scheduledInsertAttempt, reason: "prepare-failed", error: message, now: scheduleNow } );'
    );
    // Start and switch failures (ffmpeg could not be started) skip it too: it is never due for good.
    expect(flat.match(/state = await skipScheduledInsert\(\{ state, attempt: startedInsert, reason: "start-failed", error: message, now: scheduleNow \}\);/g)?.length).toBe(2);
    const skip = between(workerSource, "async function skipScheduledInsert(", "\n}\n").replace(/\s+/g, " ");
    // The audit row and the incident are written by recordSkippedInsert since M105, which the open failure
    // of a scheduled insert's retry uses as well (R13).
    expect(skip).toContain("await recordSkippedInsert(message);");
    const record = between(workerSource, "async function recordSkippedInsert(", "\n}\n").replace(/\s+/g, " ");
    expect(record).toContain('fingerprint: "playout.insert.skipped"');
    expect(record).toContain('appendAuditEvent("playout.insert.skipped", message)');
    // The cycle-end write carries the fired cuepoints from the snapshot, so the snapshot gets them too.
    expect(skip).toContain("state = { ...state, playout: { ...state.playout, ...decision.cuepoint } };");
  });
});

describe("W1: both insert checks apply quarantine and the breaker", () => {
  it("the cuepoint check passes over a blocked item", () => {
    const plan = (isAssetBlocked?: (a: AssetRecord) => boolean) =>
      getCuepointInsertPlan({
        state: stateWith(),
        currentScheduleItem: { ...current, poolId: "pool-1" },
        skippedAssetId: "",
        isAssetBlocked,
        now: at("10:15"),
        timeZone: "UTC"
      });
    expect(plan()?.asset.id).toBe("asset-sting");
    expect(plan((candidate) => candidate.sourceId === "source-yt")).toBeNull();
  });

  it("the worker's predicate is quarantine, VOD cooldown and an open breaker, used by both checks", () => {
    const predicate = between(workerSource, "function automaticItemBlockedPredicate(", "\n}\n");
    expect(predicate).toContain("new Set(poolSourceGate(state).heldSourceIds)");
    expect(predicate).toContain("isAssetBlockedForAutomaticSelection(asset) || heldSourceIds.has(asset.sourceId)");
    const autoInsert = between(workerSource, "const autoInsertAsset =", ": null;");
    expect(autoInsert).toContain("!isInsertBlocked(asset)");
    expect(autoInsert).toContain("currentSlotFree &&");
    expect(flat).toContain(
      "getCuepointInsertPlan({ state, currentScheduleItem, skippedAssetId, removedNextAssetId, isAssetBlocked: isInsertBlocked });"
    );
    expect(flat).toContain("if (cuepointInsertPlan && currentSlotFree) {");
  });
});

// R3's W6 probe (crash-abandons-item) as tests.
describe("W6: an item that failed to open is tried once more", () => {
  const T = Date.parse("2026-10-03T18:00:00.000Z");
  const failedRow = { runtimeStatus: "failed", runtimeCurrentAssetId: "B", runtimeReasonCode: "scheduled_match", processRunning: false, nowMs: T };

  it("a first open failure owes one retry and counts towards the crash-loop guard", () => {
    const exit = decideInputOpenRetryAfterExit({ previous: null, exitedAssetId: "B", immediateOpenFailure: true, nowMs: T });
    expect(exit).toEqual({ next: { assetId: "B", retried: false, failedAtMs: T }, countsTowardCrashLoop: true });
    expect(decideInputOpenRetry({ ...failedRow, retry: exit.next })).toEqual({ assetId: "B", reasonCode: "scheduled_match" });
  });

  it("the retry's own failure is final and not counted again", () => {
    const retried: InputOpenRetryState = { assetId: "B", retried: true, failedAtMs: T, reasonCode: "scheduled_match" };
    const exit = decideInputOpenRetryAfterExit({ previous: retried, exitedAssetId: "B", immediateOpenFailure: true, nowMs: T + 5_000 });
    expect(exit.countsTowardCrashLoop).toBe(false);
    expect(decideInputOpenRetry({ ...failedRow, retry: exit.next, nowMs: T + 6_000 })).toBeNull();
  });

  it("three different items failing still trip the guard; one item failing twice counts once", () => {
    // The guard counts failed exits (threshold 3); the retry adds no count of its own.
    let retry: InputOpenRetryState | null = null;
    let counted = 0;
    for (const assetId of ["A", "A", "B", "B", "C"]) {
      if (retry && retry.assetId === assetId && !retry.retried) {
        retry = { ...retry, retried: true };
      }
      const exit = decideInputOpenRetryAfterExit({ previous: retry, exitedAssetId: assetId, immediateOpenFailure: true, nowMs: T });
      counted += exit.countsTowardCrashLoop ? 1 : 0;
      retry = exit.next;
    }
    expect(counted).toBe(3);
  });

  it("an item the rotation picks again and that keeps failing counts every time after its retry", () => {
    // A pool of one: A fails, the retry fails (not counted), then each pick of A fails again. Before the
    // review fix those went uncounted for ten minutes and the guard never came on.
    let retry: InputOpenRetryState | null = null;
    let counted = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (retry && !retry.retried) {
        expect(decideInputOpenRetry({ ...failedRow, runtimeCurrentAssetId: "A", retry })?.assetId).toBe("A");
        retry = { ...retry, retried: true };
      } else if (retry) {
        expect(decideInputOpenRetry({ ...failedRow, runtimeCurrentAssetId: "A", retry })).toBeNull();
      }
      const exit = decideInputOpenRetryAfterExit({ previous: retry, exitedAssetId: "A", immediateOpenFailure: true, nowMs: T });
      counted += exit.countsTowardCrashLoop ? 1 : 0;
      retry = exit.next;
    }
    // Four failed exits, three counted: the guard's threshold.
    expect(counted).toBe(3);
  });

  it("is not owed for a failure mid-item, an operator item, a running process or an old failure", () => {
    expect(decideInputOpenRetryAfterExit({ previous: null, exitedAssetId: "B", immediateOpenFailure: false, nowMs: T }).next).toBeNull();
    const owed: InputOpenRetryState = { assetId: "B", retried: false, failedAtMs: T };
    expect(decideInputOpenRetry({ ...failedRow, retry: owed, runtimeReasonCode: "operator_insert" })).toBeNull();
    // Since M105 (review finding R13) a scheduled insert is retried once as well, with its own reason code:
    // scheduled-insert-open-retry.test.ts.
    expect(decideInputOpenRetry({ ...failedRow, retry: owed, runtimeReasonCode: "scheduled_insert" })).toEqual({
      assetId: "B",
      reasonCode: "scheduled_insert"
    });
    expect(decideInputOpenRetry({ ...failedRow, retry: owed, processRunning: true })).toBeNull();
    expect(decideInputOpenRetry({ ...failedRow, retry: owed, runtimeCurrentAssetId: "C" })).toBeNull();
    expect(decideInputOpenRetry({ ...failedRow, retry: owed, nowMs: T + INPUT_OPEN_RETRY_WINDOW_MS })).toBeNull();
    expect(decideInputOpenRetry({ ...failedRow, retry: owed, runtimeReasonCode: "manual_next" })?.assetId).toBe("B");
    expect(decideInputOpenRetry({ ...failedRow, retry: owed, runtimeReasonCode: "graceful_handoff" })?.assetId).toBe("B");
  });

  it("stays owed while the local bridge covers the remote resolve, and survives the bridge's planned exit", () => {
    const bridged: InputOpenRetryState = { assetId: "B", retried: false, failedAtMs: T, reasonCode: "scheduled_match", bridgeAssetId: "F" };
    expect(
      decideInputOpenRetry({ retry: bridged, runtimeStatus: "recovering", runtimeCurrentAssetId: "F", runtimeReasonCode: "global_fallback", processRunning: true, nowMs: T })
    ).toEqual({ assetId: "B", reasonCode: "scheduled_match" });
    // The bridge is switched away for the retry: another item's planned exit leaves the state.
    const retried = { ...bridged, retried: true };
    expect(decideInputOpenRetryAfterExit({ previous: retried, exitedAssetId: "F", immediateOpenFailure: false, nowMs: T }).next).toBe(retried);
    // The retried item plays and ends: done.
    expect(decideInputOpenRetryAfterExit({ previous: retried, exitedAssetId: "B", immediateOpenFailure: false, nowMs: T }).next).toBeNull();
  });

  it("`failed` with nothing running frees the slot for Move next and the insert checks", () => {
    expect(isCurrentItemSlotFree({ currentAssetId: "", status: "running", processRunning: true })).toBe(true);
    expect(isCurrentItemSlotFree({ currentAssetId: "B", status: "failed", processRunning: false })).toBe(true);
    expect(isCurrentItemSlotFree({ currentAssetId: "B", status: "failed", processRunning: true })).toBe(false);
    expect(isCurrentItemSlotFree({ currentAssetId: "B", status: "running", processRunning: true })).toBe(false);
  });

  it("the worker selects the retry ahead of Move next and the inserts, uses it once, and keeps the guard count", () => {
    const choose = between(workerSource, "function choosePlaybackCandidate(", "\nasync function stopPlayoutProcess(");
    expect(choose.indexOf("const retryDecision = decideInputOpenRetry(")).toBeGreaterThan(choose.indexOf("if (activeInsertAsset && state.playout.insertStatus"));
    expect(choose.indexOf("const retryDecision = decideInputOpenRetry(")).toBeLessThan(choose.indexOf("manualNextAsset &&"));
    expect(choose.replace(/\s+/g, " ")).toContain("!automaticItemBlockedPredicate(state)(asset)");
    expect(flat).toContain("inputOpenRetry = { ...inputOpenRetry, retried: true, reasonCode: selection.reasonCode };");
    expect(flat).toContain("inputOpenRetry = { ...inputOpenRetry, retried: false, bridgeAssetId: bridged.asset.id };");
    // The retry does not take the pool's position again (after a bridge the runtime names the bridge).
    expect(flat).toContain("const selectionTakesPosition = !selectionIsOpenRetry && selectionTakesPoolPosition({");
    expect(flat).toContain(
      "nonFailureExit || ranPastCrashWindow ? 0 : openRetry.countsTowardCrashLoop ? playout.crashCountWindow + 1 : playout.crashCountWindow;"
    );
  });
});
