import {
  addDaysToDateString,
  formatViewerTimeZoneName,
  getScheduleDateDayOfWeek,
  localizeViewerBuiltInText,
  viewerText,
  type ViewerLocale,
  type ViewerMessageKey
} from "@stream247/core";
import { getChannelStatusKind, getChannelUpdateNotice, getViewerChannelStatusLabel, getViewerChannelStatusLine } from "@/lib/channel-status";
import type { PublicChannelSnapshot } from "@/lib/live-broadcast";

/**
 * Everything the public page /channel says, in the channel language (M80).
 *
 * The page and its live component only lay these strings out; every word comes from here, so the
 * German page and the English one are one function apart and a test can read both without a
 * browser. The admin interface stays English (M81) and never uses this.
 *
 * Since M100 the page shows the programme item by item: a *Now* card with its progress, the next 24
 * hours grouped by programme, and the coming week. Times are written in the viewer's zone first and
 * the channel's second (owner default R2 Q7): the browser passes its zone once it has hydrated, and
 * until then (and on the server) the page is written in the channel zone, so the first paint and the
 * hydrated page agree.
 */

export type PublicChannelHeader = {
  /** The `lang` of the page's content. The root layout's <html lang="en"> also serves the admin. */
  lang: ViewerLocale;
  badge: string;
  heading: string;
  lineupTitle: string;
  lineupEyebrow: string;
};

export type PublicChannelNowView = {
  heading: string;
  title: string;
  /** "20:00 to 22:00 · Retro" in the viewer's zone, or the channel's state when nothing is scheduled. */
  detail: string;
  /** The same range in the channel zone when the viewer's differs ("19:00 to 21:00 channel time"), else "". */
  channelTime: string;
  /** 0-100, or null when there is nothing with a start and an end. */
  progressPercent: number | null;
  /** "12:34 left", or "". */
  remaining: string;
};

export type PublicChannelNextView = {
  key: string;
  timeRange: string;
  channelTime: string;
  title: string;
  detail: string;
  /** "Special" for a block with dates of its own, else "". */
  dated: string;
  /** "4 more videos", or "" when the group is one item. */
  moreLabel: string;
  more: { key: string; time: string; title: string }[];
};

export type PublicChannelWeekDayView = {
  key: string;
  /** "Today", "Tomorrow", "Mon 5 Oct". */
  label: string;
  entries: { key: string; timeRange: string; channelTime: string; title: string; detail: string; dated: string }[];
};

export type PublicChannelView = {
  lang: ViewerLocale;
  statusLabel: string;
  updateNotice: string;
  timeZoneNote: string;
  watchLabel: string;
  now: PublicChannelNowView;
  nextHeading: string;
  next: PublicChannelNextView[];
  /** Shown instead of the list when nothing is scheduled in the next 24 hours. */
  nextEmptyTitle: string;
  nextEmptyBody: string;
  weekHeading: string;
  week: PublicChannelWeekDayView[];
  weekEmpty: string;
  calendarLabel: string;
};

export function buildPublicChannelHeader(locale: ViewerLocale): PublicChannelHeader {
  return {
    lang: locale,
    badge: viewerText(locale, "channel.badge"),
    heading: viewerText(locale, "channel.heading"),
    lineupTitle: viewerText(locale, "channel.lineupTitle"),
    lineupEyebrow: viewerText(locale, "channel.badge")
  };
}

/** The page's meta description, which link previews show; the product's own tagline is not for viewers. */
export function buildPublicChannelDescription(locale: ViewerLocale): string {
  return viewerText(locale, "channel.heading");
}

const zonedFormatCache = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar date and the clock of an instant in a zone, from Intl's numeric parts only: the names a
 * runtime prints for weekdays and months differ between the server's ICU and the browser's, the digits do
 * not, so the server's first paint and the hydrated page say the same.
 */
export function zonedClock(ms: number, timeZone: string): { date: string; time: string } {
  let format = zonedFormatCache.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      });
    } catch {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      });
    }
    zonedFormatCache.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${read("year")}-${read("month")}-${read("day")}`, time: `${read("hour")}:${read("minute")}` };
}

/** "12:34" or "1:02:03": what is left of an item, as a countdown. */
export function formatProgrammeRemaining(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

/** How far an item or block is at `nowMs`: percent run (0-100, one decimal) and seconds left. */
export function describeProgrammeProgress(startsAt: string, endsAt: string, nowMs: number): { percent: number; remainingSeconds: number } | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const ratio = Math.min(1, Math.max(0, (nowMs - start) / (end - start)));
  return { percent: Math.round(ratio * 1000) / 10, remainingSeconds: Math.max(0, Math.ceil((end - Math.max(nowMs, start)) / 1000)) };
}

/** The label of a calendar day as the week list heads it: "Today", "Tomorrow", "Mon 5 Oct". */
export function formatProgrammeDayLabel(locale: ViewerLocale, date: string, today: string): string {
  if (date === today) {
    return viewerText(locale, "channel.today");
  }
  if (date === addDaysToDateString(today, 1)) {
    return viewerText(locale, "channel.tomorrow");
  }
  const [, month, day] = date.split("-").map((part) => Number(part));
  return viewerText(locale, "channel.dayLabel", {
    weekday: viewerText(locale, `channel.weekday.${getScheduleDateDayOfWeek(date)}` as ViewerMessageKey),
    day: String(day),
    month: viewerText(locale, `channel.month.${month}` as ViewerMessageKey)
  });
}

export function buildPublicChannelView(
  snapshot: PublicChannelSnapshot,
  connected: boolean,
  options: {
    /** The clock the page reads; the snapshot's own time when missing (the server, the first paint). */
    nowMs?: number;
    /** The browser's zone once the page has hydrated; the channel zone until then. */
    viewerTimeZone?: string | null;
  } = {}
): PublicChannelView {
  const locale = snapshot.locale;
  const nowMs = options.nowMs ?? Date.parse(snapshot.generatedAt);
  const channelZone = snapshot.timeZone;
  const viewerZone = options.viewerTimeZone || channelZone;
  // Two names for one clock (Europe/Paris for a Berlin channel) are one zone to a reader.
  const sameClock = (() => {
    const viewer = zonedClock(nowMs, viewerZone);
    const channel = zonedClock(nowMs, channelZone);
    return viewer.date === channel.date && viewer.time === channel.time;
  })();
  // The same equality rule as the picture: a title or category the product wrote in English
  // ("Replay standby", "Live input") is shown in the channel language, anything the operator wrote is
  // shown as written. The worker keeps those words English in state for the admin and the as-run log.
  const viewerWords = (value: string | null | undefined) => localizeViewerBuiltInText(locale, value || "");
  const clock = (iso: string, zone: string) => zonedClock(Date.parse(iso), zone).time;
  const range = (startsAt: string, endsAt: string, zone: string) =>
    viewerText(locale, "channel.timeRange", { start: clock(startsAt, zone), end: clock(endsAt, zone) });
  const channelTime = (startsAt: string, endsAt: string) =>
    sameClock ? "" : viewerText(locale, "channel.channelTime", { range: range(startsAt, endsAt, channelZone) });
  const joinDetail = (...parts: string[]) => [...new Set(parts.filter(Boolean))].join(" · ");
  const dated = (value: boolean) => (value ? viewerText(locale, "channel.dated") : "");
  const programme = snapshot.programme ?? { now: null, next: [], week: [] };
  const statusKind = getChannelStatusKind(snapshot.playout.status);

  const current = programme.now;
  const progress = current ? describeProgrammeProgress(current.startsAt, current.endsAt, nowMs) : null;
  const now: PublicChannelNowView = {
    // V2: with the playout down the card says what the schedule has now, not what is on air.
    heading: viewerText(locale, statusKind === "onAir" ? "channel.onAirNow" : "channel.scheduledNow"),
    title: viewerWords(current?.title) || viewerText(locale, "channel.standby"),
    detail: current
      ? joinDetail(range(current.startsAt, current.endsAt, viewerZone), viewerWords(current.categoryName))
      : getViewerChannelStatusLine(locale, snapshot.playout.status),
    channelTime: current ? channelTime(current.startsAt, current.endsAt) : "",
    progressPercent: progress ? progress.percent : null,
    remaining: progress ? viewerText(locale, "channel.remaining", { time: formatProgrammeRemaining(progress.remainingSeconds) }) : ""
  };

  const next = programme.next.map((group) => {
    const first = group.items[0];
    return {
      key: group.key,
      timeRange: range(group.startsAt, group.endsAt, viewerZone),
      channelTime: channelTime(group.startsAt, group.endsAt),
      title: viewerWords(first?.title || group.title),
      detail: first ? joinDetail(viewerWords(group.title), viewerWords(group.categoryName)) : viewerWords(group.categoryName),
      dated: dated(group.dated),
      moreLabel: group.itemCount > 1 ? viewerText(locale, "channel.more", { count: group.itemCount - 1 }) : "",
      more: group.items.slice(1).map((item) => ({
        key: `${group.key}:${item.startsAt}`,
        time: clock(item.startsAt, viewerZone),
        title: viewerWords(item.title)
      }))
    };
  });

  const today = zonedClock(nowMs, viewerZone).date;
  const week: PublicChannelWeekDayView[] = [];
  for (const entry of programme.week) {
    const date = zonedClock(Date.parse(entry.startsAt), viewerZone).date;
    let day = week.at(-1);
    if (!day || day.key !== date) {
      day = { key: date, label: formatProgrammeDayLabel(locale, date, today), entries: [] };
      week.push(day);
    }
    const title = viewerWords(entry.title);
    day.entries.push({
      key: entry.key,
      timeRange: range(entry.startsAt, entry.endsAt, viewerZone),
      channelTime: channelTime(entry.startsAt, entry.endsAt),
      title,
      detail: viewerWords(entry.categoryName) === title ? "" : viewerWords(entry.categoryName),
      dated: dated(entry.dated)
    });
  }

  return {
    lang: locale,
    statusLabel: getViewerChannelStatusLabel(locale, snapshot.playout.status),
    updateNotice: getChannelUpdateNotice(locale, connected),
    timeZoneNote: sameClock
      ? viewerText(locale, "channel.timeZoneNote", { timeZone: snapshot.timeZoneLabel })
      : viewerText(locale, "channel.viewerTimeZoneNote", {
          viewerZone: formatViewerTimeZoneName(locale, viewerZone, new Date(nowMs)),
          channelZone: snapshot.timeZoneLabel
        }),
    watchLabel: viewerText(locale, "channel.watch"),
    now,
    nextHeading: viewerText(locale, "channel.upNext"),
    next,
    nextEmptyTitle: viewerText(locale, "channel.noNext"),
    nextEmptyBody: viewerText(locale, "channel.noNextBody"),
    weekHeading: viewerText(locale, "channel.weekTitle"),
    week,
    weekEmpty: viewerText(locale, "channel.weekEmpty"),
    calendarLabel: viewerText(locale, "channel.calendar")
  };
}
