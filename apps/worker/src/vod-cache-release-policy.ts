import { addDaysToDateString, buildScheduleOccurrences, type ScheduleBlock } from "@stream247/core";

/**
 * Whether a replay that just finished playing should stay in the cache (M62).
 *
 * Until M62 the cache deleted the finished file at once and downloaded it again when the schedule
 * came back round: on 2026-09-04 that released and re-fetched 2.38, 14.51, 4.04 and 9.47 GB, and a
 * replay that came round before its re-download finished aired from Twitch directly. The rule now:
 * a replay whose source feeds a pool that a block within the retention horizon draws from stays on
 * disk. The horizon is the cache's retention setting — the operator already says how long a
 * downloaded file may wait for its slot; this makes the same number decide whether one is thrown
 * away after airing.
 */
export function collectUpcomingPoolIds(args: {
  blocks: ScheduleBlock[];
  /** Channel-local date "YYYY-MM-DD" and time "HH:MM", from getCurrentScheduleMoment. */
  date: string;
  time: string;
  horizonMinutes: number;
}): Set<string> {
  const [hours, minutes] = args.time.split(":").map((part) => Number(part));
  const nowMinute = (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
  const horizonEnd = nowMinute + Math.max(0, args.horizonMinutes);
  const poolIds = new Set<string>();

  const consider = (dayOffset: number) => {
    const date = dayOffset === 0 ? args.date : addDaysToDateString(args.date, dayOffset);
    for (const occurrence of buildScheduleOccurrences({ date, blocks: args.blocks })) {
      if (!occurrence.poolId) {
        continue;
      }
      const start = dayOffset * 1440 + occurrence.startMinuteOfDay;
      const end = start + Math.max(1, occurrence.durationMinutes ?? 1);
      // Starts inside the horizon, or is on air right now and has not ended.
      if ((start >= nowMinute && start <= horizonEnd) || (start <= nowMinute && end > nowMinute)) {
        poolIds.add(occurrence.poolId);
      }
    }
  };
  consider(0);
  const days = Math.ceil(horizonEnd / 1440);
  for (let offset = 1; offset <= days; offset += 1) {
    consider(offset);
  }
  return poolIds;
}

export function shouldKeepFinishedVodCache(args: {
  assetSourceId: string;
  pools: ReadonlyArray<{ id: string; sourceIds: readonly string[] }>;
  upcomingPoolIds: ReadonlySet<string>;
}): boolean {
  if (!args.assetSourceId || args.upcomingPoolIds.size === 0) {
    return false;
  }
  return args.pools.some((pool) => args.upcomingPoolIds.has(pool.id) && pool.sourceIds.includes(args.assetSourceId));
}
