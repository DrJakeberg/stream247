import { describe, expect, it } from "vitest";
import { buildScheduleVideoTimelineSegments } from "../../apps/web/lib/schedule-video-timeline";

describe("schedule video timeline", () => {
  it("converts video slot durations into bounded block-relative widths", () => {
    const segments = buildScheduleVideoTimelineSegments({
      id: "block-a",
      title: "Prime Block",
      startTime: "20:00",
      endTime: "21:00",
      durationMinutes: 60,
      categoryName: "Gaming",
      dayOfWeek: 5,
      poolId: "pool-prime",
      sourceName: "Prime Pool",
      reason: "Selected from Prime Pool.",
      videoSlots: [
        {
          assetId: "asset-a",
          title: "Program A",
          startOffsetSeconds: 0,
          estimatedDurationSeconds: 15 * 60,
          estimatedDuration: false
        },
        {
          assetId: "asset-b",
          title: "Program B",
          startOffsetSeconds: 15 * 60,
          estimatedDurationSeconds: 45 * 60,
          estimatedDuration: true
        }
      ]
    });

    expect(segments.map((segment) => segment.widthPercent)).toEqual([25, 75]);
    expect(segments[1]).toEqual(
      expect.objectContaining({
        assetId: "asset-b",
        title: "Program B",
        estimatedDuration: true
      })
    );
  });
});
