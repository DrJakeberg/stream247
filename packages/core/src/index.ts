export type ModerationConfig = {
  enabled: boolean;
  command: string;
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  requirePrefix: boolean;
  fallbackEmoteOnly: boolean;
};

export type PresenceWindow = {
  actor: string;
  minutes: number;
  expiresAt: Date;
  createdAt: Date;
};

export type PresenceStatus = {
  active: boolean;
  chatMode: "normal" | "emote-only";
  summary: string;
};

export type ScheduleBlock = {
  id: string;
  title: string;
  categoryName: string;
  startMinuteOfDay: number;
  durationMinutes: number;
  sourceName: string;
};

export type SchedulePreview = {
  date: string;
  items: Array<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    categoryName: string;
    sourceName: string;
    reason: string;
  }>;
};

export function isLikelyYouTubePlaylistUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      ["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"].includes(host) &&
      url.searchParams.has("list")
    );
  } catch {
    return false;
  }
}

export function isLikelyTwitchVodUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (host === "twitch.tv" || host === "www.twitch.tv") && /\/videos\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatMinuteOfDay(value: number): string {
  const normalized = ((Math.trunc(value) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${padTwo(Math.floor(normalized / 60))}:${padTwo(normalized % 60)}`;
}

export function parseTimeOfDay(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function extractZonedParts(args: { now: Date; timeZone: string }) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: args.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(args.now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`
  };
}

export function createDefaultModerationConfig(): ModerationConfig {
  return {
    enabled: true,
    command: "here",
    defaultMinutes: 30,
    minMinutes: 5,
    maxMinutes: 240,
    requirePrefix: false,
    fallbackEmoteOnly: true
  };
}

export function parseModeratorCheckIn(args: {
  actor: string;
  input: string;
  now: Date;
  config: ModerationConfig;
}): PresenceWindow | null {
  const { actor, input, now, config } = args;

  if (!config.enabled) {
    return null;
  }

  const prefix = config.requirePrefix ? "!" : "";
  const match = input.trim().match(new RegExp(`^${prefix}${config.command}(?:\\s+(\\d+))?$`, "i"));

  if (!match) {
    return null;
  }

  const rawMinutes = match[1] ? Number(match[1]) : config.defaultMinutes;

  if (!Number.isFinite(rawMinutes)) {
    return null;
  }

  const minutes = Math.min(config.maxMinutes, Math.max(config.minMinutes, rawMinutes));

  return {
    actor,
    minutes,
    createdAt: now,
    expiresAt: new Date(now.getTime() + minutes * 60_000)
  };
}

export function describePresenceStatus(args: {
  activeWindows: PresenceWindow[];
  now: Date;
  fallbackEmoteOnly: boolean;
}): PresenceStatus {
  const activeWindows = args.activeWindows.filter((window) => window.expiresAt > args.now);

  if (activeWindows.length > 0) {
    const latestExpiry = activeWindows
      .map((window) => window.expiresAt.toISOString())
      .sort()
      .at(-1);

    return {
      active: true,
      chatMode: "normal",
      summary: `Moderator coverage active until ${latestExpiry}.`
    };
  }

  return {
    active: false,
    chatMode: args.fallbackEmoteOnly ? "emote-only" : "normal",
    summary: args.fallbackEmoteOnly
      ? "No moderator presence window is active. Emote-only fallback should be enabled."
      : "No moderator presence window is active."
  };
}

export function buildSchedulePreview(args: {
  date: string;
  blocks: ScheduleBlock[];
}): SchedulePreview {
  const items = [...args.blocks]
    .sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay)
    .map((block) => {
      const startMinutes = block.startMinuteOfDay;
      const endMinutes = (startMinutes + block.durationMinutes) % (24 * 60);

      return {
        id: block.id,
        title: block.title,
        startTime: formatMinuteOfDay(startMinutes),
        endTime: formatMinuteOfDay(endMinutes),
        categoryName: block.categoryName,
        sourceName: block.sourceName,
        reason: `Selected from ${block.sourceName} for ${block.durationMinutes} minutes.`
      };
    });

  return { date: args.date, items };
}

export function getCurrentScheduleMoment(args: { now: Date; timeZone: string }) {
  return extractZonedParts(args);
}

export function isCurrentScheduleTime(args: {
  startTime: string;
  endTime: string;
  currentTime: string;
}) {
  if (args.endTime > args.startTime) {
    return args.currentTime >= args.startTime && args.currentTime < args.endTime;
  }

  return args.currentTime >= args.startTime || args.currentTime < args.endTime;
}

export function validateScheduleBlock(block: {
  title: string;
  categoryName: string;
  sourceName: string;
  startMinuteOfDay: number;
  durationMinutes: number;
}) {
  if (!block.title.trim() || !block.categoryName.trim() || !block.sourceName.trim()) {
    return "Title, category, and source are required.";
  }

  if (
    !Number.isInteger(block.startMinuteOfDay) ||
    block.startMinuteOfDay < 0 ||
    block.startMinuteOfDay >= 24 * 60
  ) {
    return "Start time must be within the current day.";
  }

  if (!Number.isInteger(block.durationMinutes) || block.durationMinutes < 15 || block.durationMinutes > 24 * 60) {
    return "Duration must be between 15 and 1440 minutes.";
  }

  return null;
}

export function findScheduleConflicts(blocks: Array<ScheduleBlock>): string[] {
  const conflicts = new Set<string>();

  for (let index = 0; index < blocks.length; index += 1) {
    const current = blocks[index];
    if (!current) {
      continue;
    }

    const currentRanges =
      current.startMinuteOfDay + current.durationMinutes <= 24 * 60
        ? [[current.startMinuteOfDay, current.startMinuteOfDay + current.durationMinutes]]
        : [
            [current.startMinuteOfDay, 24 * 60],
            [0, (current.startMinuteOfDay + current.durationMinutes) % (24 * 60)]
          ];

    for (let compareIndex = index + 1; compareIndex < blocks.length; compareIndex += 1) {
      const candidate = blocks[compareIndex];
      if (!candidate) {
        continue;
      }

      const candidateRanges =
        candidate.startMinuteOfDay + candidate.durationMinutes <= 24 * 60
          ? [[candidate.startMinuteOfDay, candidate.startMinuteOfDay + candidate.durationMinutes]]
          : [
              [candidate.startMinuteOfDay, 24 * 60],
              [0, (candidate.startMinuteOfDay + candidate.durationMinutes) % (24 * 60)]
            ];

      const overlaps = currentRanges.some(([currentStart, currentEnd]) =>
        candidateRanges.some(
          ([candidateStart, candidateEnd]) => currentStart < candidateEnd && candidateStart < currentEnd
        )
      );

      if (overlaps) {
        conflicts.add(current.id);
        conflicts.add(candidate.id);
      }
    }
  }

  return [...conflicts];
}
