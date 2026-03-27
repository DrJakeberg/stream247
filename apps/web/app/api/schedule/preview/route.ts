import { NextResponse } from "next/server";
import { buildSchedulePreview } from "@stream247/core";

export function GET() {
  return NextResponse.json(
    buildSchedulePreview({
      date: "2026-03-27",
      blocks: [
        {
          id: "morning",
          title: "Morning Archive",
          categoryName: "Just Chatting",
          startHour: 8,
          durationMinutes: 180,
          sourceName: "Twitch Archive"
        },
        {
          id: "night",
          title: "Late Playlist",
          categoryName: "Music",
          startHour: 20,
          durationMinutes: 240,
          sourceName: "YouTube Playlist"
        }
      ]
    })
  );
}

