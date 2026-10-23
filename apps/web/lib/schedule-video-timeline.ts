import { formatScheduleHours, type MaterializedProgrammingBlock } from "@stream247/core";

export type ScheduleVideoTimelineSegment = {
  assetId: string;
  title: string;
  widthPercent: number;
  /** Air time before it in the block that is not this block's (a dated block's cut, the item before running over). */
  gapBeforePercent: number;
  startOffsetSeconds: number;
  estimatedDurationSeconds: number;
  estimatedDuration: boolean;
};

/**
 * The Day lens's video bar for one block, from the week projection (M119): each pool carries on from where
 * its previous block left off, as on air and in the week view, so two blocks of one pool on one day no
 * longer show the same first videos. Until M119 it was built from the pool's stored position for every
 * block (`buildSchedulePreviewVideoSlots`).
 */
export function buildScheduleVideoTimelineSegments(block: MaterializedProgrammingBlock): ScheduleVideoTimelineSegment[] {
  const blockStartSecond = block.startMinuteOfDay * 60;
  const blockSeconds = Math.max(1, block.durationMinutes) * 60;
  const blockEndSecond = blockStartSecond + blockSeconds;

  let drawnUntil = blockStartSecond;
  return block.items.flatMap((item) => {
    const start = item.startSecond ?? blockStartSecond;
    const end = item.endSecond ?? start + item.durationMinutes * 60;
    // An item that runs past the block's end is drawn up to it; the list below the bar names the overrun.
    const visibleStart = Math.max(blockStartSecond, start);
    const visibleEnd = Math.min(blockEndSecond, end);
    if (visibleEnd <= visibleStart) {
      return [];
    }
    const gapBeforePercent = Math.max(0, ((visibleStart - drawnUntil) / blockSeconds) * 100);
    drawnUntil = Math.max(drawnUntil, visibleEnd);
    return [
      {
        assetId: item.assetId,
        title: item.title,
        widthPercent: Math.max(0, Math.min(100, ((visibleEnd - visibleStart) / blockSeconds) * 100)),
        gapBeforePercent,
        startOffsetSeconds: visibleStart - blockStartSecond,
        estimatedDurationSeconds: visibleEnd - visibleStart,
        estimatedDuration: item.estimatedDuration
      }
    ];
  });
}

/** A block's numbers in words, for the Day lens: "2 h of different videos · 4 h planned · 3 inserts". */
export function describeMaterializedBlockFill(
  block: Pick<MaterializedProgrammingBlock, "uniqueMinutes" | "projectedMinutes" | "insertCount" | "cuepointCount">
): string {
  return [
    `${formatScheduleHours(block.uniqueMinutes)} of different videos`,
    `${formatScheduleHours(block.projectedMinutes)} planned`,
    block.insertCount > 0 ? `${block.insertCount} insert${block.insertCount === 1 ? "" : "s"}` : "",
    block.cuepointCount > 0 ? `${block.cuepointCount} of them at a set time` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}
