import { describe, expect, it } from "vitest";
import { buildSchedulePreview, getCurrentScheduleMoment, isCurrentScheduleTime } from "@stream247/core";

describe("schedule preview", () => {
  it("sorts blocks and calculates time windows", () => {
    const preview = buildSchedulePreview({
      date: "2026-03-27",
      blocks: [
        {
          id: "b",
          title: "Night",
          categoryName: "Music",
          startHour: 22,
          durationMinutes: 120,
          sourceName: "Playlist"
        },
        {
          id: "a",
          title: "Morning",
          categoryName: "Chatting",
          startHour: 8,
          durationMinutes: 60,
          sourceName: "Archive"
        }
      ]
    });

    expect(preview.items[0]?.id).toBe("a");
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
});
