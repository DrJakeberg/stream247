import { describe, expect, it } from "vitest";
import {
  buildSchedulePreview,
  findScheduleConflicts,
  getCurrentScheduleMoment,
  isCurrentScheduleTime
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
          startMinuteOfDay: 22 * 60,
          durationMinutes: 120,
          sourceName: "Playlist"
        },
        {
          id: "a",
          title: "Morning",
          categoryName: "Chatting",
          startMinuteOfDay: 8 * 60 + 15,
          durationMinutes: 60,
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
        startMinuteOfDay: 8 * 60,
        durationMinutes: 120,
        sourceName: "Archive"
      },
      {
        id: "b",
        title: "Overlap",
        categoryName: "Music",
        startMinuteOfDay: 9 * 60,
        durationMinutes: 60,
        sourceName: "Playlist"
      }
    ]);

    expect(conflicts).toEqual(["a", "b"]);
  });
});
