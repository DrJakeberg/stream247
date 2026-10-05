import {
  getCuepointProgress,
  getCurrentScheduleMoment,
  getScheduleOccurrenceAirWindowSeconds,
  getScheduleOccurrenceRunKey,
  getScheduleRunElapsedSeconds,
  isCurrentScheduleTime,
  normalizeCuepointOffsetsSeconds,
  resolveBlockCuepointAssetId
} from "@stream247/core";
import { resolveChannelTimeZone, type AppState, type AssetRecord } from "@stream247/db";

type CurrentScheduleItemLike = {
  blockId: string;
  key: string;
  title: string;
  startTime: string;
  endTime: string;
  startMinuteOfDay: number;
  durationMinutes: number;
  poolId?: string;
  date?: string;
  carriesOverFromPreviousDay?: boolean;
  effectiveStartMinuteOfDay?: number;
  airWindows?: Array<{ start: number; end: number }>;
};

export type CuepointInsertPlan = {
  asset: AssetRecord;
  cuepointKey: string;
  offsetSeconds: number;
  blockId: string;
  blockTitle: string;
  poolId: string;
  usingBlockOverride: boolean;
  nextOffsetSeconds: number | null;
  firedCount: number;
  totalCount: number;
};

type CuepointArgs = {
  state: AppState;
  currentScheduleItem: CurrentScheduleItemLike | null;
  skippedAssetId: string;
  // The operator's Remove next hold (M89), held out like the skip hold.
  removedNextAssetId?: string;
  // Quarantine and the source breaker (M94, R3 W1): every other automatic pick applies them, and an
  // insert that skipped them was picked, failed and picked again at every boundary.
  isAssetBlocked?: (asset: AssetRecord) => boolean;
  now?: Date;
  timeZone?: string;
};

function evaluateCuepoints(args: CuepointArgs) {
  const currentScheduleItem = args.currentScheduleItem;
  if (!currentScheduleItem?.poolId) {
    return null;
  }

  const now = args.now ?? new Date();
  const timeZone = args.timeZone ?? resolveChannelTimeZone(args.state.managedConfig);
  const scheduleMoment = getCurrentScheduleMoment({ now, timeZone });
  if (
    !isCurrentScheduleTime({
      startTime: currentScheduleItem.startTime,
      endTime: currentScheduleItem.endTime,
      currentTime: scheduleMoment.time
    })
  ) {
    return null;
  }

  const block = args.state.scheduleBlocks.find((entry) => entry.id === currentScheduleItem.blockId) ?? null;
  const pool = args.state.pools.find((entry) => entry.id === currentScheduleItem.poolId) ?? null;
  if (!block || !pool) {
    return null;
  }

  const cuepointOffsetsSeconds = normalizeCuepointOffsetsSeconds(block.cuepointOffsetsSeconds ?? [], block.durationMinutes);
  if (cuepointOffsetsSeconds.length === 0) {
    return null;
  }

  // Shared with the week view and the live view (M94, R3 W5).
  const cuepointAssetId = resolveBlockCuepointAssetId(block, pool);
  if (!cuepointAssetId) {
    return null;
  }

  const asset =
    args.state.assets.find(
      (entry) =>
        entry.id === cuepointAssetId &&
        entry.status === "ready" &&
        entry.includeInProgramming !== false &&
        entry.id !== args.skippedAssetId &&
        entry.id !== (args.removedNextAssetId ?? "") &&
        !(args.isAssetBlocked?.(entry) ?? false)
    ) ?? null;
  if (!asset) {
    return null;
  }

  // Keyed by the run, not the day's occurrence: after 00:00 a block crossing midnight is the next day's
  // carry-over with a new key, and the cuepoints it fired before midnight must stay fired. Every stored key
  // names its run, so the whole list is read: since R8 it also holds the run before the last change, which
  // is what a block coming back after another one (the October fall-back night) finds its keys in.
  const runKey = getScheduleOccurrenceRunKey(currentScheduleItem);
  const firedCuepointKeys = args.state.playout.cuepointFiredKeys;
  // Real seconds, not wall-clock minutes (M101): on the spring-forward day a cuepoint fired an hour early.
  const elapsedSeconds = getScheduleRunElapsedSeconds({ occurrence: currentScheduleItem, now, timeZone });
  const progress = getCuepointProgress({
    occurrenceKey: runKey,
    cuepointOffsetsSeconds,
    firedCuepointKeys,
    elapsedSeconds,
    // A weekly block cut around a dated one (M93) fires only the cuepoints of the window on air now.
    airWindowsSeconds: getScheduleOccurrenceAirWindowSeconds(
      {
        effectiveStartMinuteOfDay: currentScheduleItem.effectiveStartMinuteOfDay ?? currentScheduleItem.startMinuteOfDay,
        airWindows: currentScheduleItem.airWindows,
        date: currentScheduleItem.date
      },
      timeZone
    )
  });

  return { block, pool, asset, progress, elapsedSeconds };
}

export function getCuepointInsertPlan(args: CuepointArgs): CuepointInsertPlan | null {
  const evaluated = evaluateCuepoints(args);
  if (!evaluated) {
    return null;
  }
  const { block, pool, asset, progress } = evaluated;

  if (progress.dueOffsetSeconds === null || !progress.dueCuepointKey) {
    return null;
  }

  return {
    asset,
    cuepointKey: progress.dueCuepointKey,
    offsetSeconds: progress.dueOffsetSeconds,
    blockId: block.id,
    blockTitle: block.title,
    poolId: pool.id,
    usingBlockOverride: Boolean(block.cuepointAssetId),
    nextOffsetSeconds: progress.nextOffsetSeconds,
    firedCount: progress.firedCount,
    totalCount: progress.totalCount
  };
}

/**
 * The cuepoint item the queue scan warms (M94, R3 W1): the one that is due and waits for the next item
 * boundary, or the one whose next cuepoint comes within `lookaheadSeconds`. A YouTube or Twitch insert was
 * never warmed, because the rotation leaves it out, so every boundary that was due for it found it cold.
 */
export function getCuepointWarmAsset(args: CuepointArgs & { lookaheadSeconds: number }): AssetRecord | null {
  const evaluated = evaluateCuepoints(args);
  if (!evaluated) {
    return null;
  }
  const { asset, progress, elapsedSeconds } = evaluated;
  if (progress.dueOffsetSeconds !== null) {
    return asset;
  }
  if (progress.nextOffsetSeconds !== null && progress.nextOffsetSeconds - elapsedSeconds <= args.lookaheadSeconds) {
    return asset;
  }
  return null;
}
