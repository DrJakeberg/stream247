// Resuming an interrupted item at its position (M124, PLANS.md M77).
//
// Until M124 a pool item that was cut before its end was lost: a crash, a container restart or a
// repin, a Play now, a Pin, a Live Bridge or a dated block took it off air, and when the pool came back
// it picked the item after it (the pool's position already named the cut item, and the selection keeps
// an item only while its process runs). An archive cut after four of its six hours never aired its last
// two. Now the playout keeps where the item stood, per pool, and the pool's next pick continues it there.
//
// The owner's rules (2026-10-26, "Ja, wie empfohlen"):
// 1. Every unwanted cut keeps the position. A Skip, a Restart (which means "from the start") and the end
//    of the item do not.
// 2. The position holds until the pool is on air again, for at most 24 hours since the cut.
// 3. The item continues 10 s before the cut. An item that aired less than 2 minutes starts again from
//    the beginning; one with less than 2 minutes left is not continued, the pool picks the next item.
// 4. Only an item that plays from a file on disk (a library file, a cached Twitch archive) continues:
//    there the seek is exact. A remote archive or a YouTube pair keeps today's behaviour.
//
// This module is the shared vocabulary and the pure rules; the playout applies them
// (apps/worker/src/resume-interrupted.ts) and the playout row stores the points (resume_points).

/** Where a pool's interrupted item stood. One per pool at most. */
export type ResumePoint = {
  assetId: string;
  /** The pool whose rotation picked the item; its next pick continues the item. */
  poolId: string;
  /** Whole seconds into the item when it was last seen on air. */
  positionSeconds: number;
  /** ISO, UTC: when that position was taken (the cut, or the last cycle that saw the item on air). */
  savedAt: string;
  /**
   * How often the item was continued from this point without airing 2 minutes in one go since (a start
   * that failed to open, a container that died with it). Left out when 0.
   */
  shortStarts?: number;
  /** ISO, UTC: the start of the run that shortStarts last counted, so a run is counted once. */
  shortStartAt?: string;
};

/** The item continues this far before where it was cut, so the viewer finds the thread again. */
export const RESUME_REWIND_SECONDS = 10;
/** An item that aired less than this starts again from the beginning. */
export const RESUME_MIN_AIRED_SECONDS = 120;
/** An item with less than this left is not continued: the pool picks the next one. */
export const RESUME_MIN_REMAINING_SECONDS = 120;
/** A point is kept this long after it was taken; after that the pool goes on as it did before M124. */
export const RESUME_VALID_MS = 24 * 60 * 60 * 1000;
/** No more points than this are stored, the newest kept (a schedule with more pools than this is unheard of). */
export const RESUME_MAX_POINTS = 16;
/**
 * A point continued this often without the item airing 2 minutes is given up, and the pool picks the next
 * item: a file that stopped opening (the M94 retry included) or a spot that takes the container down
 * cannot come back for 24 hours.
 */
export const RESUME_MAX_SHORT_STARTS = 2;

function isPoint(value: unknown): value is ResumePoint {
  const entry = value as Partial<ResumePoint> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.assetId === "string" &&
    entry.assetId !== "" &&
    typeof entry.poolId === "string" &&
    entry.poolId !== "" &&
    typeof entry.positionSeconds === "number" &&
    Number.isFinite(entry.positionSeconds) &&
    entry.positionSeconds >= 0 &&
    typeof entry.savedAt === "string" &&
    Number.isFinite(Date.parse(entry.savedAt))
  );
}

/** The stored list, read leniently: an unreadable column or entry reads as no point, never as an error. */
export function parseResumePoints(value: unknown): ResumePoint[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isPoint).map((entry) => {
    const shortStarts = Math.floor(Number(entry.shortStarts) || 0);
    return {
      assetId: entry.assetId,
      poolId: entry.poolId,
      positionSeconds: Math.floor(entry.positionSeconds),
      savedAt: entry.savedAt,
      ...(shortStarts > 0 ? { shortStarts, shortStartAt: typeof entry.shortStartAt === "string" ? entry.shortStartAt : "" } : {})
    };
  });
}

/** Has the point been continued too often without the item airing 2 minutes? Then it is not continued again. */
export function isResumePointExhausted(point: ResumePoint): boolean {
  return (point.shortStarts ?? 0) >= RESUME_MAX_SHORT_STARTS;
}

/**
 * The point with the run that continued it counted as a short start, once per run (`startedAtMs`, the
 * run's process start). The start, every checkpoint and the exit of the run may each count it; whichever
 * is written first does.
 */
export function countResumeShortStart(point: ResumePoint, startedAtMs: number): ResumePoint {
  const startedAt = new Date(startedAtMs).toISOString();
  if (point.shortStartAt === startedAt) {
    return point;
  }
  return { ...point, shortStarts: (point.shortStarts ?? 0) + 1, shortStartAt: startedAt };
}

/** Is the point still owed: taken within the last 24 hours (a point from the future reads as owed). */
export function isResumePointValid(point: ResumePoint, nowMs: number): boolean {
  const savedAtMs = Date.parse(point.savedAt);
  return Number.isFinite(savedAtMs) && nowMs - savedAtMs < RESUME_VALID_MS;
}

/** The pool's point, or null. */
export function resumePointOfPool(points: readonly ResumePoint[], poolId: string): ResumePoint | null {
  return points.find((point) => point.poolId === poolId) ?? null;
}

/** The list with the point for its pool replaced (or added), newest first and bounded. */
export function upsertResumePoint(points: readonly ResumePoint[], point: ResumePoint): ResumePoint[] {
  return [point, ...points.filter((entry) => entry.poolId !== point.poolId)].slice(0, RESUME_MAX_POINTS);
}

/** The list without any point for the item (it ended, was skipped or restarted from the start). */
export function removeResumePointsOfAsset(points: readonly ResumePoint[], assetId: string): ResumePoint[] {
  return points.filter((point) => point.assetId !== assetId);
}

/**
 * The points still owed. A point leaves when it is older than 24 hours, and when its pool has moved on:
 * the pool's stored position no longer names the item (the pool picked the next one, which is what it
 * does when a point is not to be continued) or the pool is gone.
 */
export function pruneResumePoints(args: {
  points: readonly ResumePoint[];
  pools: ReadonlyArray<{ id: string; cursorAssetId?: string }>;
  nowMs: number;
}): ResumePoint[] {
  return args.points.filter((point) => {
    if (!isResumePointValid(point, args.nowMs)) {
      return false;
    }
    const pool = args.pools.find((entry) => entry.id === point.poolId);
    return Boolean(pool) && (pool?.cursorAssetId ?? "") === point.assetId;
  });
}

export type ResumeStart =
  /** Continue the item at `startSeconds` (0: it aired too little, it starts again from the beginning). */
  | { kind: "resume"; startSeconds: number }
  /** Too little is left: the pool picks the next item, as without a point. */
  | { kind: "drop" };

/**
 * Where an item with a point starts. `durationSeconds` 0 or less means the length is unknown: then
 * nothing is too little left, and the item continues.
 */
export function decideResumeStart(args: { positionSeconds: number; durationSeconds: number }): ResumeStart {
  const position = Math.max(0, Math.floor(args.positionSeconds));
  const duration = Number.isFinite(args.durationSeconds) && args.durationSeconds > 0 ? Math.floor(args.durationSeconds) : 0;
  if (duration > 0 && duration - position < RESUME_MIN_REMAINING_SECONDS) {
    return { kind: "drop" };
  }
  if (position < RESUME_MIN_AIRED_SECONDS) {
    return { kind: "resume", startSeconds: 0 };
  }
  return { kind: "resume", startSeconds: Math.max(0, position - RESUME_REWIND_SECONDS) };
}

/**
 * The instant position 0 of the item on air would have aired: the process start, earlier by the
 * position the process started at. Everything that reads "how far into the item are we" (chapters, the
 * expected end, the week projection) reads this, not the process start. "" when nothing is on air.
 */
export function onAirItemZeroAt(playout: { processStartedAt: string; currentStartOffsetSeconds?: number }): string {
  if (!playout.processStartedAt) {
    return "";
  }
  const startedAtMs = Date.parse(playout.processStartedAt);
  if (!Number.isFinite(startedAtMs)) {
    return playout.processStartedAt;
  }
  const offset = Number(playout.currentStartOffsetSeconds) || 0;
  return offset > 0 ? new Date(startedAtMs - Math.floor(offset) * 1000).toISOString() : playout.processStartedAt;
}

