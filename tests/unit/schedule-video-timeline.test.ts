import { describe, expect, it } from "vitest";
import type { MaterializedProgrammingBlock } from "@stream247/core";
import { buildScheduleVideoTimelineSegments } from "../../apps/web/lib/schedule-video-timeline";

describe("schedule video timeline", () => {
  it("converts the projected items' air times into bounded block-relative widths", () => {
    const item = (assetId: string, startSecond: number, endSecond: number, estimatedDuration: boolean) => ({
      kind: "asset" as const,
      assetId,
      title: assetId === "asset-a" ? "Program A" : "Program B",
      durationMinutes: (endSecond - startSecond) / 60,
      startTime: "",
      endTime: "",
      overflow: false,
      repeated: false,
      estimatedDuration,
      startSecond,
      endSecond
    });
    const segments = buildScheduleVideoTimelineSegments({
      blockId: "block-a",
      title: "Prime Block",
      startMinuteOfDay: 20 * 60,
      durationMinutes: 60,
      items: [item("asset-a", 72_000, 72_900, false), item("asset-b", 72_900, 75_600, true)]
    } as MaterializedProgrammingBlock);

    expect(segments.map((segment) => segment.widthPercent)).toEqual([25, 75]);
    expect(segments[1]).toEqual(
      expect.objectContaining({
        assetId: "asset-b",
        title: "Program B",
        startOffsetSeconds: 15 * 60,
        estimatedDuration: true
      })
    );
  });
});
