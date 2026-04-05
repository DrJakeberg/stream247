import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  buildMaterializedProgrammingWeek,
  buildScheduleOccurrences,
  buildSchedulePreview,
  describeScheduleRepeatMode,
  findScheduleConflicts,
  getRepeatDaysForMode,
  getCurrentScheduleMoment,
  isCurrentScheduleTime,
  summarizeScheduleWeek
} from "@stream247/core";

describe("schedule preview", () => {
  it("sorts blocks and calculates time windows", () => {
    const preview = buildSchedulePreview({
      date: "2026-03-27",
      blocks: [
        {
          id: "b",
          title: "Night",
          categoryName: "Music",
          dayOfWeek: 5,
          startMinuteOfDay: 22 * 60,
          durationMinutes: 120,
          poolId: "pool-night",
          sourceName: "Playlist"
        },
        {
          id: "a",
          title: "Morning",
          categoryName: "Chatting",
          dayOfWeek: 5,
          startMinuteOfDay: 8 * 60 + 15,
          durationMinutes: 60,
          poolId: "pool-morning",
          sourceName: "Archive"
        }
      ]
    });

    expect(preview.items[0]?.id).toBe("a");
    expect(preview.items[0]?.startTime).toBe("08:15");
    expect(preview.items[1]?.endTime).toBe("00:00");
  });

  it("derives the local date and time for a configured timezone", () => {
    const moment = getCurrentScheduleMoment({
      now: new Date("2026-03-27T22:30:00.000Z"),
      timeZone: "Europe/Berlin"
    });

    expect(moment.date).toBe("2026-03-27");
    expect(moment.time).toBe("23:30");
  });

  it("treats overnight blocks as active before midnight", () => {
    expect(
      isCurrentScheduleTime({
        startTime: "22:00",
        endTime: "00:00",
        currentTime: "23:30"
      })
    ).toBe(true);
  });

  it("detects overlapping schedule blocks", () => {
    const conflicts = findScheduleConflicts([
      {
        id: "a",
        title: "Morning",
        categoryName: "Chatting",
        dayOfWeek: 5,
        startMinuteOfDay: 8 * 60,
        durationMinutes: 120,
        poolId: "pool-a",
        sourceName: "Archive"
      },
      {
        id: "b",
        title: "Overlap",
        categoryName: "Music",
        dayOfWeek: 5,
        startMinuteOfDay: 9 * 60,
        durationMinutes: 60,
        poolId: "pool-b",
        sourceName: "Playlist"
      }
    ]);

    expect(conflicts).toEqual(["a", "b"]);
  });

  it("builds keyed schedule occurrences for a local day", () => {
    const occurrences = buildScheduleOccurrences({
      date: "2026-03-27",
      blocks: [
        {
          id: "a",
          title: "Morning",
          categoryName: "Chatting",
          dayOfWeek: 5,
          startMinuteOfDay: 8 * 60,
          durationMinutes: 60,
          poolId: "pool-a",
          sourceName: "Archive"
        }
      ]
    });

    expect(occurrences[0]?.key).toBe("2026-03-27:a:480:60");
    expect(occurrences[0]?.endTime).toBe("09:00");
  });

  it("materializes programming windows with repeat and insert awareness", () => {
    const week = buildMaterializedProgrammingWeek({
      startDate: "2026-03-30",
      blocks: [
        {
          id: "block_prime",
          title: "Prime",
          categoryName: "Gaming",
          dayOfWeek: 1,
          startMinuteOfDay: 20 * 60,
          durationMinutes: 120,
          poolId: "pool_prime",
          sourceName: "Prime Pool",
          repeatMode: "weekdays",
          repeatGroupId: "repeat_prime"
        }
      ],
      pools: [
        {
          id: "pool_prime",
          name: "Prime Pool",
          sourceIds: ["source_prime"],
          cursorAssetId: "",
          insertAssetId: "insert_1",
          insertEveryItems: 2,
          itemsSinceInsert: 1
        }
      ],
      assets: [
        {
          id: "asset_a",
          sourceId: "source_prime",
          title: "Episode A",
          status: "ready",
          includeInProgramming: true,
          durationSeconds: 30 * 60,
          createdAt: "2026-03-01T00:00:00.000Z"
        },
        {
          id: "asset_b",
          sourceId: "source_prime",
          title: "Episode B",
          status: "ready",
          includeInProgramming: true,
          durationSeconds: 30 * 60,
          createdAt: "2026-03-02T00:00:00.000Z"
        },
        {
          id: "insert_1",
          sourceId: "source_prime",
          title: "Channel ID",
          status: "ready",
          includeInProgramming: true,
          durationSeconds: 5 * 60,
          createdAt: "2026-03-03T00:00:00.000Z"
        }
      ]
    });

    expect(week[0]?.blocks[0]?.repeatLabel).toBe("Weekdays");
    expect(week[0]?.blocks[0]?.fillStatus).toBe("underfilled");
    expect(week[0]?.blocks[0]?.insertCount).toBe(2);
    expect(week[0]?.blocks[0]?.queuePreview[0]).toContain("Episode A");
  });

  it("marks windows as underfilled when the pool must repeat inside a block", () => {
    const week = buildMaterializedProgrammingWeek({
      startDate: "2026-03-29",
      blocks: [
        {
          id: "block_weekend",
          title: "Weekend Loop",
          categoryName: "Replay",
          dayOfWeek: 0,
          startMinuteOfDay: 10 * 60,
          durationMinutes: 180,
          poolId: "pool_loop",
          sourceName: "Loop Pool",
          repeatMode: "weekends"
        }
      ],
      pools: [
        {
          id: "pool_loop",
          name: "Loop Pool",
          sourceIds: ["source_loop"],
          cursorAssetId: "",
          insertAssetId: "",
          insertEveryItems: 0,
          itemsSinceInsert: 0
        }
      ],
      assets: [
        {
          id: "asset_short",
          sourceId: "source_loop",
          title: "One Clip",
          status: "ready",
          includeInProgramming: true,
          durationSeconds: 45 * 60,
          createdAt: "2026-03-01T00:00:00.000Z"
        }
      ]
    });

    expect(week[0]?.blocks[0]?.fillStatus).toBe("underfilled");
    expect(week[0]?.blocks[0]?.items.some((item) => item.repeated)).toBe(true);
  });

  it("adds days to a local schedule date string", () => {
    expect(addDaysToDateString("2026-03-27", 2)).toBe("2026-03-29");
  });

  it("resolves deterministic repeat day sets", () => {
    expect(getRepeatDaysForMode("weekdays")).toEqual([1, 2, 3, 4, 5]);
    expect(getRepeatDaysForMode("weekends")).toEqual([0, 6]);
    expect(describeScheduleRepeatMode("daily", 1)).toBe("Daily");
  });

  it("summarizes weekly schedule coverage by weekday", () => {
    const summary = summarizeScheduleWeek([
      {
        id: "a",
        title: "Morning",
        categoryName: "Chatting",
        dayOfWeek: 1,
        startMinuteOfDay: 8 * 60,
        durationMinutes: 120,
        poolId: "pool-a",
        sourceName: "Archive"
      },
      {
        id: "b",
        title: "Afternoon",
        categoryName: "Music",
        dayOfWeek: 1,
        startMinuteOfDay: 14 * 60,
        durationMinutes: 180,
        poolId: "pool-b",
        sourceName: "Playlist"
      }
    ]);

    expect(summary[1]).toEqual({
      dayOfWeek: 1,
      blockCount: 2,
      scheduledMinutes: 300,
      firstStartMinute: 480,
      lastEndMinute: 1020
    });
    expect(summary[2]?.blockCount).toBe(0);
  });
});
