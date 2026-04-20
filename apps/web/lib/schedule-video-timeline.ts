import type { SchedulePreview } from "@stream247/core";

type SchedulePreviewItem = SchedulePreview["items"][number];

export type ScheduleVideoTimelineSegment = {
  assetId: string;
  title: string;
  widthPercent: number;
  startOffsetSeconds: number;
  estimatedDurationSeconds: number;
  estimatedDuration: boolean;
};

export function buildScheduleVideoTimelineSegments(item: SchedulePreviewItem): ScheduleVideoTimelineSegment[] {
  const blockSeconds = Math.max(1, item.durationMinutes) * 60;

  return item.videoSlots.map((slot) => ({
    assetId: slot.assetId,
    title: slot.title,
    widthPercent: Math.max(0, Math.min(100, (slot.estimatedDurationSeconds / blockSeconds) * 100)),
    startOffsetSeconds: slot.startOffsetSeconds,
    estimatedDurationSeconds: slot.estimatedDurationSeconds,
    estimatedDuration: slot.estimatedDuration
  }));
}
