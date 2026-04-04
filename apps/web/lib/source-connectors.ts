export type SourceConnectorKind =
  | "local-library"
  | "direct-media"
  | "youtube-playlist"
  | "youtube-channel"
  | "twitch-vod"
  | "twitch-channel";

export type SourceConnectorDefinition = {
  id: SourceConnectorKind;
  label: string;
  shortLabel: string;
  description: string;
  helper: string;
  urlLabel: string;
  placeholder: string;
  example: string;
  notes: string;
  suggestedName: string;
  requiresUrl: boolean;
};

export const sourceConnectorDefinitions: SourceConnectorDefinition[] = [
  {
    id: "local-library",
    label: "Local media library",
    shortLabel: "Local library",
    description: "Play files already stored on this server from the shared media folder.",
    helper: "Best for self-hosted operators who want a simple, stable local catalog without relying on third-party URLs.",
    urlLabel: "Media folder",
    placeholder: "",
    example: "Uses ./data/media automatically",
    notes: "Worker scans the shared local media folder and turns playable files into assets.",
    suggestedName: "Local Media Library",
    requiresUrl: false
  },
  {
    id: "direct-media",
    label: "Direct media URL",
    shortLabel: "Direct URL",
    description: "Add a single directly reachable video file or streamable media URL.",
    helper: "Useful for CDN-hosted MP4 files, one-off replay clips, or fixed archive URLs.",
    urlLabel: "Media URL",
    placeholder: "https://cdn.example.com/replay.mp4",
    example: "https://cdn.example.com/replay.mp4",
    notes: "Worker validates and normalizes supported direct media URLs into playable assets.",
    suggestedName: "Direct Media Feed",
    requiresUrl: true
  },
  {
    id: "youtube-playlist",
    label: "YouTube playlist",
    shortLabel: "YT playlist",
    description: "Ingest every video from a YouTube playlist into your catalog.",
    helper: "Best when you already curate a replay or archive playlist on YouTube.",
    urlLabel: "Playlist URL",
    placeholder: "https://www.youtube.com/playlist?list=PL...",
    example: "https://www.youtube.com/playlist?list=PL1234567890",
    notes: "Worker ingests playlist entries through yt-dlp and preserves natural video metadata.",
    suggestedName: "YouTube Playlist",
    requiresUrl: true
  },
  {
    id: "youtube-channel",
    label: "YouTube channel",
    shortLabel: "YT channel",
    description: "Track a whole YouTube channel and ingest its uploaded videos as assets.",
    helper: "Good for archive channels where the upstream creator keeps publishing new replay content.",
    urlLabel: "Channel URL",
    placeholder: "https://www.youtube.com/@channel/videos",
    example: "https://www.youtube.com/@channel/videos",
    notes: "Worker ingests channel videos through yt-dlp and keeps original titles and durations.",
    suggestedName: "YouTube Channel",
    requiresUrl: true
  },
  {
    id: "twitch-vod",
    label: "Twitch VOD",
    shortLabel: "Twitch VOD",
    description: "Add a single Twitch VOD as a replay source.",
    helper: "Useful for one-off archive imports or special event replays.",
    urlLabel: "VOD URL",
    placeholder: "https://www.twitch.tv/videos/1234567890",
    example: "https://www.twitch.tv/videos/1234567890",
    notes: "Worker ingests the VOD through yt-dlp and uses Twitch metadata when available.",
    suggestedName: "Twitch VOD",
    requiresUrl: true
  },
  {
    id: "twitch-channel",
    label: "Twitch channel archive",
    shortLabel: "Twitch archive",
    description: "Track archived VODs from a Twitch channel and keep ingesting new ones over time.",
    helper: "Best for replay channels built from an existing Twitch creator archive.",
    urlLabel: "Channel URL",
    placeholder: "https://www.twitch.tv/username",
    example: "https://www.twitch.tv/username",
    notes: "Worker ingests archive VODs from the Twitch channel and keeps Twitch title/category metadata.",
    suggestedName: "Twitch Archive",
    requiresUrl: true
  }
];

export function getSourceConnectorDefinition(kind: SourceConnectorKind): SourceConnectorDefinition {
  return sourceConnectorDefinitions.find((entry) => entry.id === kind) ?? sourceConnectorDefinitions[0];
}
