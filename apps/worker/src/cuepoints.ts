import {
  getCuepointProgress,
  getCurrentScheduleMoment,
  getScheduleElapsedSeconds,
  isCurrentScheduleTime,
  normalizeCuepointOffsetsSeconds
} from "@stream247/core";
import type { AppState, AssetRecord } from "@stream247/db";

type CurrentScheduleItemLike = {
  blockId: string;
  key: string;
  title: string;
  startTime: string;
  endTime: string;
  startMinuteOfDay: number;
  durationMinutes: number;
  poolId?: string;
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

export function getCuepointInsertPlan(args: {
  state: AppState;
  currentScheduleItem: CurrentScheduleItemLike | null;
  skippedAssetId: string;
  now?: Date;
  timeZone?: string;
}): CuepointInsertPlan | null {
  const currentScheduleItem = args.currentScheduleItem;
  if (!currentScheduleItem?.poolId) {
    return null;
  }

  const scheduleMoment = getCurrentScheduleMoment({
    now: args.now ?? new Date(),
    timeZone: args.timeZone ?? process.env.CHANNEL_TIMEZONE ?? "UTC"
  });
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

  const cuepointAssetId = block.cuepointAssetId || pool.insertAssetId || "";
  if (!cuepointAssetId) {
    return null;
  }

  const asset =
    args.state.assets.find(
      (entry) =>
        entry.id === cuepointAssetId &&
        entry.status === "ready" &&
        entry.includeInProgramming !== false &&
        entry.id !== args.skippedAssetId
    ) ?? null;
  if (!asset) {
    return null;
  }

  const firedCuepointKeys =
    args.state.playout.cuepointWindowKey === currentScheduleItem.key ? args.state.playout.cuepointFiredKeys : [];
  const progress = getCuepointProgress({
    occurrenceKey: currentScheduleItem.key,
    cuepointOffsetsSeconds,
    firedCuepointKeys,
    elapsedSeconds: getScheduleElapsedSeconds({
      startMinuteOfDay: currentScheduleItem.startMinuteOfDay,
      currentTime: scheduleMoment.time
    })
  });

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
