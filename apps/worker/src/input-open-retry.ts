/**
 * An item that failed to open is tried once more (M94, R3 W6 in planning/research/robustness.md).
 *
 * After an immediate input-open failure (a stale googlevideo URL, a 403 on the first request) the exit
 * handler drops the item's probe cache so that "the next attempt" re-resolves it. But the pool's position
 * already named the failed item, so the next cycle picked the item after it: the next attempt came only
 * when the rotation came round again, and the failed item was lost for that pass. Now the next cycle
 * starts the same item once more, with a fresh resolve. A second failure is final: the rotation moves on.
 *
 * The crash-loop guard counts failed exits (three within ten minutes). The retry's own failure is not
 * counted, so the retry never brings the guard on sooner than before: three different items that fail
 * still trip it, the same item failing twice counts once, and every failure of it after that counts. Resuming an item that failed mid-way is M77
 * (deferred); this is only an item that never started.
 *
 * No I/O here; the worker keeps the state in memory (a restart forgets it, which costs at most the retry).
 */

export interface InputOpenRetryState {
  assetId: string;
  // The retry was started; a further failure of the same item is final.
  retried: boolean;
  // The retry failed too: nothing more is owed, and every further failure counts again.
  exhausted?: boolean;
  // When the item failed to open.
  failedAtMs: number;
  // The selection that started the item, kept for the retry (the runtime row moves on to a bridge).
  reasonCode?: string;
  // The local item bridged onto air while the retry's remote input is resolved (shouldBridgeToFallback-
  // BeforeResolve): the retry is still owed while it runs.
  bridgeAssetId?: string;
}

// A retry is owed for this long after the failure; after that a new failure of the item is a new one.
export const INPUT_OPEN_RETRY_WINDOW_MS = 10 * 60_000;

export interface InputOpenRetryExitInput {
  previous: InputOpenRetryState | null;
  exitedAssetId: string;
  // isImmediateInputOpenFailure on an unplanned exit.
  immediateOpenFailure: boolean;
  nowMs: number;
}

export interface InputOpenRetryExit {
  next: InputOpenRetryState | null;
  // False only for the failure of the retry itself (see the module note).
  countsTowardCrashLoop: boolean;
}

function isCurrent(state: InputOpenRetryState | null, nowMs: number): state is InputOpenRetryState {
  return state !== null && nowMs - state.failedAtMs < INPUT_OPEN_RETRY_WINDOW_MS;
}

/**
 * What an exit leaves. Another item's exit (the bridge being switched away for the retry, say) leaves the
 * state as it is; the item's own exit that was not an open failure ends it (it played).
 */
export function decideInputOpenRetryAfterExit(input: InputOpenRetryExitInput): InputOpenRetryExit {
  const previous = isCurrent(input.previous, input.nowMs) ? input.previous : null;
  if (!input.immediateOpenFailure || !input.exitedAssetId) {
    const ownExit = previous !== null && input.exitedAssetId !== "" && previous.assetId === input.exitedAssetId;
    return { next: ownExit ? null : previous, countsTowardCrashLoop: true };
  }
  if (previous?.assetId === input.exitedAssetId && previous.retried) {
    // Only the retry's own failure goes uncounted. An item that the rotation picks again and that keeps
    // failing (a pool of one, say) counts every time after it, so the crash-loop guard still comes on.
    return {
      next: { ...previous, bridgeAssetId: "", exhausted: true },
      countsTowardCrashLoop: previous.exhausted === true
    };
  }
  return { next: { assetId: input.exitedAssetId, retried: false, failedAtMs: input.nowMs }, countsTowardCrashLoop: true };
}

// The selections that play an item to its end: the pool's pick, a graceful hand-off, a Move next, and since
// M105 a scheduled insert (review finding R13). An operator insert or override has its own rules. A
// scheduled insert is used up when it starts (its cuepoint fired, the pool's counter reset), so before it
// was never retried: a YouTube sting whose first format candidate was refused (exit 8, a 403 on the
// googlevideo URL) was lost after one try, with neither a retry nor a skipped report. Its retry starts
// with the next format candidate (the exit handler recorded the failed one) and uses nothing up again:
// it carries no trigger, and the worker holds it on air like any scheduled insert (scheduled-insert.ts).
const RETRIED_REASON_CODES = new Set(["scheduled_match", "graceful_handoff", "manual_next", "scheduled_insert"]);

export interface InputOpenRetrySelectionInput {
  retry: InputOpenRetryState | null;
  runtimeStatus: string;
  runtimeCurrentAssetId: string;
  runtimeReasonCode: string;
  processRunning: boolean;
  nowMs: number;
}

export interface InputOpenRetrySelection {
  assetId: string;
  reasonCode: string;
}

/**
 * The item to start again now, null for none. Eligibility (ready, holds, quarantine) is the caller's.
 * Either the item that failed is still named on air with nothing running, or the local bridge that covers
 * its resolve is running.
 */
export function decideInputOpenRetry(input: InputOpenRetrySelectionInput): InputOpenRetrySelection | null {
  const retry = input.retry;
  if (!isCurrent(retry, input.nowMs) || retry.retried) {
    return null;
  }
  if (retry.bridgeAssetId && input.processRunning && input.runtimeCurrentAssetId === retry.bridgeAssetId && retry.reasonCode) {
    return { assetId: retry.assetId, reasonCode: retry.reasonCode };
  }
  if (input.processRunning || input.runtimeStatus !== "failed" || retry.assetId !== input.runtimeCurrentAssetId) {
    return null;
  }
  if (!RETRIED_REASON_CODES.has(input.runtimeReasonCode)) {
    return null;
  }
  return { assetId: retry.assetId, reasonCode: input.runtimeReasonCode };
}

/**
 * Whether the item slot is free for a Move next, a pool insert or a cuepoint insert. An item that failed
 * (`failed`, nothing running) stays named as the current item until the next start, so these checks,
 * which wait for an empty current item, let one more item pass first: a queued Move next slipped by one
 * item, and so did a due insert.
 */
export function isCurrentItemSlotFree(input: { currentAssetId: string; status: string; processRunning: boolean }): boolean {
  return input.currentAssetId === "" || (input.status === "failed" && !input.processRunning);
}

/**
 * A scheduled insert whose once-more start failed to open as well (R13): final, and reported as skipped
 * (playout.insert.skipped, reason open-failed) like an insert that could not be prepared, since its cuepoint
 * or the pool's counter was already used up by the first start.
 */
export function isFinalScheduledInsertOpenFailure(input: { exit: InputOpenRetryExit; immediateOpenFailure: boolean }): boolean {
  return input.immediateOpenFailure && input.exit.next?.exhausted === true && input.exit.next.reasonCode === "scheduled_insert";
}

/**
 * A scheduled insert's once-more start that fails before ffmpeg runs it (review of M105, 2026-10-05): the
 * resolve throws (no format candidate left, a 403 at resolve; the first failure dropped the probe entry, so
 * the retry always resolves afresh) or the start itself fails. Final too, and reported as skipped like the
 * retry that fails to open (isFinalScheduledInsertOpenFailure). The retry carries no trigger, so the
 * cycle's own skip (for an insert that is used up by this start) never saw it: the insert was lost with
 * only the generic preparation incident, and the M94 DUT check found neither an aired nor a skipped row.
 * Nothing is used up again; the first start did that.
 */
export function isFailedScheduledInsertRetry(input: { selectionIsOpenRetry: boolean; reasonCode: string; insertTrigger: string }): boolean {
  return input.selectionIsOpenRetry && input.reasonCode === "scheduled_insert" && input.insertTrigger === "";
}
