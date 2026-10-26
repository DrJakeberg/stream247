/**
 * Resuming an interrupted item at its position (M124, PLANS.md M77): the playout's side.
 *
 * The rules and the stored shape are in @stream247/core (resume-point.ts). Here: which run keeps a point
 * at all, what each way a run can end does to its point, the checkpoint every cycle writes while the
 * item plays, and the pick that continues it.
 *
 * Why a checkpoint and not only the exit: a redeploy, a repin or a host restart kills ffmpeg with the
 * container, and no exit handler runs (the as-run row of that run is closed as process-gone at the next
 * boot). The cycle-end write that every playout cycle makes anyway carries the position of the item on
 * air, at most one cycle (15 s) old; an exit the playout sees writes the exact one.
 *
 * No I/O here.
 */

import {
  decideResumeStart,
  isResumePointValid,
  pruneResumePoints,
  removeResumePointsOfAsset,
  resumePointOfPool,
  RESUME_MIN_AIRED_SECONDS,
  upsertResumePoint,
  type ResumePoint
} from "@stream247/core";
import { asRunInputKindOf, type AsRunStopIntent } from "./as-run.js";
import { ITEM_ENDING_STOP_REASONS } from "./playout-boundary.js";

/** The run on air that keeps a point: a pool's own pick, played from a file on disk. */
export type ResumeRun = {
  assetId: string;
  poolId: string;
  /** Where in the item the process started. */
  startOffsetSeconds: number;
  /** The run continues a point (from its position, or from 0 when it aired too little before). */
  resumed: boolean;
  startedAtMs: number;
};

/**
 * Can this input start part-way? A library file or a cached Twitch archive is a path on disk, where
 * `-ss` before the input is exact and instant. A remote archive (HLS) or a YouTube pair (two inputs) is
 * not in this milestone (owner, 2026-10-26: their seek can only be checked on the DUT).
 */
export function isSeekableInput(args: { input: string; audioInput: string }): boolean {
  return asRunInputKindOf({ targetKind: "asset", input: args.input, audioInput: args.audioInput }) === "local";
}

/**
 * The run a start puts on air, or null when it keeps no point: only an item the pool's rotation picked
 * (scheduled_match, including a continued one), with a pool, from a seekable input. An insert, a Pin, a
 * Move next, a fallback or a live input is none of the pool's.
 */
export function resumeRunOf(args: {
  targetKind: string;
  reasonCode: string;
  poolId: string;
  assetId: string;
  input: string;
  audioInput: string;
  startOffsetSeconds: number;
  resumed: boolean;
  startedAtMs: number;
}): ResumeRun | null {
  if (
    args.targetKind !== "asset" ||
    args.reasonCode !== "scheduled_match" ||
    args.poolId === "" ||
    args.assetId === "" ||
    !isSeekableInput({ input: args.input, audioInput: args.audioInput })
  ) {
    return null;
  }
  return {
    assetId: args.assetId,
    poolId: args.poolId,
    startOffsetSeconds: Math.max(0, Math.floor(args.startOffsetSeconds)),
    resumed: args.resumed,
    startedAtMs: args.startedAtMs
  };
}

/** Whole seconds into the item at `nowMs`. */
export function resumeRunPositionAt(run: ResumeRun, nowMs: number): number {
  return run.startOffsetSeconds + Math.max(0, Math.floor((nowMs - run.startedAtMs) / 1000));
}

/**
 * What an exit means for the item's point.
 *
 * - `ended`: the item is done with -- its end (EOF, the duration bound, a feed watchdog that ends a
 *   stalled item), a Skip, or a Restart, which means "from the start".
 * - `cut`: something else took the air -- a Play now, a Pin or Fallback, a Live Bridge, a dated block, a
 *   planned reconnect, the crash-loop reset, a destination that went missing.
 * - `failed`: ffmpeg died on its own.
 * - `open-failure`: the input never opened; M94 starts the item once more and the point stays as it was.
 */
export type ResumeExitKind = "ended" | "cut" | "failed" | "open-failure";

export function classifyResumeExit(args: {
  plannedReason: string;
  stopIntent: AsRunStopIntent;
  naturalBoundary: boolean;
  exitedCleanly: boolean;
  immediateOpenFailure: boolean;
}): ResumeExitKind {
  if (args.plannedReason === "") {
    if (args.immediateOpenFailure) {
      return "open-failure";
    }
    // A clean exit nobody asked for is the end of the input, as the as-run log reads it.
    return args.naturalBoundary || args.exitedCleanly ? "ended" : "failed";
  }
  if (ITEM_ENDING_STOP_REASONS.has(args.plannedReason)) {
    return "ended";
  }
  if (args.plannedReason === "restart-requested") {
    // Restart and Skip end the item; a restart request that put something else on air (direct mode's Pin,
    // Fallback or Play now, asRunRestartIntentOf) cut it.
    return args.stopIntent === "switch" ? "cut" : "ended";
  }
  if (args.plannedReason === "switch") {
    return args.stopIntent === "skip" ? "ended" : "cut";
  }
  // scheduled-reconnect, crash-loop-reset, destination-missing, and a stop reason added later: the item
  // did not reach its end, so its place is kept rather than lost.
  return "cut";
}

/**
 * The points after the run's exit. A continued item that fails again before it aired 2 minutes is given
 * up, so an item that kills ffmpeg at the same place cannot come back for ever: the pool picks the next
 * one, as without a point.
 */
export function decideResumePointsAfterExit(args: {
  points: readonly ResumePoint[];
  run: ResumeRun | null;
  kind: ResumeExitKind;
  exitedAtMs: number;
}): ResumePoint[] {
  const { run } = args;
  if (!run || args.kind === "open-failure") {
    return [...args.points];
  }
  if (args.kind === "ended") {
    return removeResumePointsOfAsset(args.points, run.assetId);
  }
  const airedSeconds = Math.max(0, Math.floor((args.exitedAtMs - run.startedAtMs) / 1000));
  if (args.kind === "failed" && run.resumed && airedSeconds < RESUME_MIN_AIRED_SECONDS) {
    return removeResumePointsOfAsset(args.points, run.assetId);
  }
  return upsertResumePoint(args.points, {
    assetId: run.assetId,
    poolId: run.poolId,
    positionSeconds: resumeRunPositionAt(run, args.exitedAtMs),
    savedAt: new Date(args.exitedAtMs).toISOString()
  });
}

/**
 * The points the cycle-end write leaves: the ones still owed (not older than 24 h, their pool still
 * standing on the item), and the position of the run on air. The run's own point is written after the
 * pruning, never judged by it: the pool's position is stored after this write in the cycle that starts
 * the item, so the pool still names the item before it.
 */
export function decideResumeCheckpoint(args: {
  points: readonly ResumePoint[];
  run: ResumeRun | null;
  processRunning: boolean;
  pools: ReadonlyArray<{ id: string; cursorAssetId?: string }>;
  nowMs: number;
}): ResumePoint[] {
  const owed = pruneResumePoints({ points: args.points, pools: args.pools, nowMs: args.nowMs });
  if (!args.run || !args.processRunning) {
    return owed;
  }
  return upsertResumePoint(owed, {
    assetId: args.run.assetId,
    poolId: args.run.poolId,
    positionSeconds: resumeRunPositionAt(args.run, args.nowMs),
    savedAt: new Date(args.nowMs).toISOString()
  });
}

export type ResumePick<T> = { asset: T; startSeconds: number; positionSeconds: number };

/**
 * The pool's interrupted item and where it starts, or null when the pool picks as before: no point, a
 * point older than 24 hours, a pool that has moved on, the item on air already, an item the pool may not
 * take now (not ready, held out, quarantined: `isEligible`), or less than 2 minutes left.
 */
export function pickResumeItem<T extends { id: string; durationSeconds?: number }>(args: {
  points: readonly ResumePoint[];
  pool: { id: string; cursorAssetId?: string } | null;
  assets: readonly T[];
  isEligible: (asset: T) => boolean;
  runningAssetId: string;
  nowMs: number;
}): ResumePick<T> | null {
  if (!args.pool) {
    return null;
  }
  const point = resumePointOfPool(args.points, args.pool.id);
  if (!point || !isResumePointValid(point, args.nowMs) || (args.pool.cursorAssetId ?? "") !== point.assetId) {
    return null;
  }
  if (args.runningAssetId === point.assetId) {
    return null;
  }
  const asset = args.assets.find((entry) => entry.id === point.assetId);
  if (!asset || !args.isEligible(asset)) {
    return null;
  }
  const start = decideResumeStart({ positionSeconds: point.positionSeconds, durationSeconds: Number(asset.durationSeconds) || 0 });
  return start.kind === "resume" ? { asset, startSeconds: start.startSeconds, positionSeconds: point.positionSeconds } : null;
}
