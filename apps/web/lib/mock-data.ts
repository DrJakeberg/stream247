import {
  buildSchedulePreview,
  createDefaultModerationConfig,
  describePresenceStatus,
  parseModeratorCheckIn
} from "@stream247/core";

const moderationConfig = createDefaultModerationConfig();
const checkIn = parseModeratorCheckIn({
  actor: "mod_streamlead",
  input: "here 30",
  now: new Date("2026-03-27T10:00:00.000Z"),
  config: moderationConfig
});

export const moderationState = {
  config: moderationConfig,
  latestCheckIn: checkIn,
  status: describePresenceStatus({
    activeWindows: checkIn ? [checkIn] : [],
    now: new Date("2026-03-27T10:10:00.000Z"),
    fallbackEmoteOnly: true
  })
};

export const schedulePreview = buildSchedulePreview({
  date: "2026-03-27",
  blocks: [
    {
      id: "morning-vods",
      title: "Morning Twitch VOD Rotation",
      categoryName: "Just Chatting",
      startHour: 6,
      durationMinutes: 240,
      sourceName: "Twitch Archive"
    },
    {
      id: "playlist-prime",
      title: "Prime Time YouTube Playlist",
      categoryName: "Music",
      startHour: 18,
      durationMinutes: 360,
      sourceName: "YouTube Playlist"
    }
  ]
});

