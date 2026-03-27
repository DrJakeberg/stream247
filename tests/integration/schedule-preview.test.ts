import { describe, expect, it } from "vitest";
import { buildSchedulePreview } from "@stream247/core";

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
});
