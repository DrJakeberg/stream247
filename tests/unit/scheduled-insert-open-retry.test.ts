import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideInputOpenRetry,
  decideInputOpenRetryAfterExit,
  isFailedScheduledInsertRetry,
  isFinalScheduledInsertOpenFailure,
  type InputOpenRetryState
} from "../../apps/worker/src/input-open-retry";
import { describeSkippedInsert, keepsRunningScheduledInsert } from "../../apps/worker/src/scheduled-insert";

// M105, review finding R13: a remote scheduled insert that started but failed at input-open (a YouTube sting
// whose first format candidate gets exit 8 or a 403) was neither retried nor reported as skipped.

const T = Date.parse("2026-10-05T20:00:00.000Z");
const failedInsertRow = { runtimeStatus: "failed", runtimeCurrentAssetId: "sting", runtimeReasonCode: "scheduled_insert", processRunning: false };

describe("a scheduled insert that fails to open", () => {
  it("is started once more, as the same scheduled insert, and held on air once it runs", () => {
    const first = decideInputOpenRetryAfterExit({ previous: null, exitedAssetId: "sting", immediateOpenFailure: true, nowMs: T });
    expect(isFinalScheduledInsertOpenFailure({ exit: first, immediateOpenFailure: true })).toBe(false);
    const retry = decideInputOpenRetry({ ...failedInsertRow, retry: first.next, nowMs: T + 1_000 });
    expect(retry).toEqual({ assetId: "sting", reasonCode: "scheduled_insert" });
    // The retry played: from its next cycle the R11 hold keeps it (no trigger, nothing used up again).
    expect(
      keepsRunningScheduledInsert({
        processRunning: true,
        scheduleTakeover: false,
        runtimeReasonCode: retry!.reasonCode,
        runtimeCurrentAssetId: "sting",
        runningAssetId: "sting",
        heldOutAssetIds: []
      })
    ).toBe(true);
    // Its later exit (not an open failure) ends the retry state.
    const played: InputOpenRetryState = { ...first.next!, retried: true, reasonCode: "scheduled_insert" };
    expect(decideInputOpenRetryAfterExit({ previous: played, exitedAssetId: "sting", immediateOpenFailure: false, nowMs: T + 60_000 }).next).toBeNull();
  });

  it("is reported as skipped when the retry is refused too, and only then", () => {
    // The worker marks the retry started with the selection's reason code (index.ts, selectionIsOpenRetry).
    const retried: InputOpenRetryState = { assetId: "sting", retried: true, failedAtMs: T, reasonCode: "scheduled_insert" };
    const second = decideInputOpenRetryAfterExit({ previous: retried, exitedAssetId: "sting", immediateOpenFailure: true, nowMs: T + 5_000 });
    expect(second.next).toMatchObject({ exhausted: true, reasonCode: "scheduled_insert" });
    expect(isFinalScheduledInsertOpenFailure({ exit: second, immediateOpenFailure: true })).toBe(true);
    // Nothing more is owed: the schedule goes on.
    expect(decideInputOpenRetry({ ...failedInsertRow, retry: second.next, nowMs: T + 6_000 })).toBeNull();
  });

  it("does not report a pool item's final failure, an insert that played, or a first failure", () => {
    const poolRetried: InputOpenRetryState = { assetId: "a1", retried: true, failedAtMs: T, reasonCode: "scheduled_match" };
    const poolFinal = decideInputOpenRetryAfterExit({ previous: poolRetried, exitedAssetId: "a1", immediateOpenFailure: true, nowMs: T });
    expect(isFinalScheduledInsertOpenFailure({ exit: poolFinal, immediateOpenFailure: true })).toBe(false);
    const insertRetried: InputOpenRetryState = { assetId: "sting", retried: true, failedAtMs: T, reasonCode: "scheduled_insert" };
    const playedOut = decideInputOpenRetryAfterExit({ previous: insertRetried, exitedAssetId: "sting", immediateOpenFailure: false, nowMs: T });
    expect(isFinalScheduledInsertOpenFailure({ exit: playedOut, immediateOpenFailure: false })).toBe(false);
  });

  it("names the insert and both tries in the incident", () => {
    expect(describeSkippedInsert({ title: "YouTube Sting", trigger: "", reason: "open-failed", error: "HTTP error 403 Forbidden" })).toBe(
      "Scheduled insert YouTube Sting could not be opened, on two tries (HTTP error 403 Forbidden), so it was skipped once and counted as played. The schedule continues; the next insert is tried as usual."
    );
  });
});

describe("a scheduled insert whose retry fails before ffmpeg runs it (review of M105)", () => {
  it("is final and reported: its resolve threw (no candidate left, a 403 at resolve) or its start failed", () => {
    expect(isFailedScheduledInsertRetry({ selectionIsOpenRetry: true, reasonCode: "scheduled_insert", insertTrigger: "" })).toBe(true);
    // The first start is the cycle's own skip (scheduledInsertAttemptOf, it has a trigger); a pool item's
    // retry is no insert; a selection that is not the retry (the bridge, a recovery) reports nothing.
    expect(isFailedScheduledInsertRetry({ selectionIsOpenRetry: false, reasonCode: "scheduled_insert", insertTrigger: "cuepoint" })).toBe(false);
    expect(isFailedScheduledInsertRetry({ selectionIsOpenRetry: true, reasonCode: "scheduled_match", insertTrigger: "" })).toBe(false);
    expect(isFailedScheduledInsertRetry({ selectionIsOpenRetry: false, reasonCode: "global_fallback", insertTrigger: "" })).toBe(false);
  });

  it("names the insert and why in the incident, with nothing used up again", () => {
    expect(describeSkippedInsert({ title: "Sting", trigger: "", reason: "prepare-failed", error: "no format candidate left" })).toBe(
      "Scheduled insert Sting could not be prepared (no format candidate left), so it was skipped once and counted as played. The schedule continues; the next insert is tried as usual."
    );
  });

  it("is reported by the worker where the retry's resolve fails and where its start fails", () => {
    const flat = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8").replace(/\s+/g, " ");
    expect(flat).toContain(
      "const failedInsertRetry = isFailedScheduledInsertRetry({ selectionIsOpenRetry, reasonCode: selection.reasonCode, insertTrigger: selection.insertTrigger });"
    );
    expect(flat).toContain(
      '} else if (failedInsertRetry) { await reportScheduledInsertOpenFailed(failedAsset.id, message, bridgingInsert ? "bridged" : "prepare-failed"); }'
    );
    expect(flat).toContain("bridgingInsert = scheduledInsertAttempt !== null || failedInsertRetry;");
    expect(
      flat.match(
        /\} else if \(selection\.asset && isFailedScheduledInsertRetry\(\{ selectionIsOpenRetry, reasonCode: selection\.reasonCode, insertTrigger: selection\.insertTrigger \}\)\) \{ await reportScheduledInsertOpenFailed\(selection\.asset\.id, message, "start-failed"\); \}/g
      )?.length
    ).toBe(2);
  });
});

describe("R13 wiring in the worker", () => {
  const flat = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8").replace(/\s+/g, " ");

  it("starts the retry of a scheduled insert as an insert, and reports the final failure from the exit handler", () => {
    expect(flat).toContain('queueKind: retryDecision.reasonCode === "scheduled_insert" ? "insert" : "asset", inputOpenRetry: true,');
    expect(flat).toContain(
      "inputOpenRetry = openRetry.next; // A scheduled insert refused on both tries is skipped with an incident, like one that could not be // prepared (R13); its first start already used up its cuepoint or the pool's counter. if (isFinalScheduledInsertOpenFailure({ exit: openRetry, immediateOpenFailure })) { void reportScheduledInsertOpenFailed(lastAssetId, lastStderrSample || exitReason)"
    );
    // The log line comes before the first await, so it is written even with the database away.
    expect(flat).toContain(
      'logRuntimeEvent("playout.insert.skipped", { assetId, trigger: "", reason, ...(error ? { error } : {}) }); const state = await readAppState();'
    );
    expect(flat).toContain('reason: ScheduledInsertSkipReason = "open-failed"');
  });
});
