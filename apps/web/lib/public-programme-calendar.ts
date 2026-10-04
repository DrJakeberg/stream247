import { localizeViewerBuiltInText, viewerText, type ViewerLocale } from "@stream247/core";
import type { PublicProgrammeWeekEntry } from "@/lib/public-programme";

/**
 * The public programme as a calendar feed (M100, R1 row B): /channel.ics, the coming week block by block,
 * for a calendar app to subscribe to. RFC 5545: CRLF line ends, lines folded at 75 octets, text escaped,
 * times in UTC so no VTIMEZONE is needed and every app shows them in its own zone.
 */

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets, never inside a UTF-8 sequence. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** 20261004T180000Z */
function formatUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildProgrammeCalendar(args: {
  entries: PublicProgrammeWeekEntry[];
  locale: ViewerLocale;
  channelName: string;
  timeZone: string;
  now: Date;
}): string {
  const words = (value: string) => localizeViewerBuiltInText(args.locale, value || "");
  const stamp = formatUtc(args.now.toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Stream247//Public programme//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(viewerText(args.locale, "channel.calendarName", { channel: args.channelName }))}`,
    `X-WR-TIMEZONE:${escapeText(args.timeZone)}`,
    // How often a subscribing app should fetch it again.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H"
  ];
  for (const entry of args.entries) {
    const title = words(entry.title);
    const category = words(entry.categoryName);
    const description = [entry.dated ? viewerText(args.locale, "channel.dated") : "", category !== title ? category : ""]
      .filter(Boolean)
      .join(" · ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${entry.key.replace(/[^A-Za-z0-9._:@-]/g, "-")}@stream247`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatUtc(entry.startsAt)}`,
      `DTEND:${formatUtc(entry.endsAt)}`,
      `SUMMARY:${escapeText(title)}`,
      ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
      ...(category ? [`CATEGORIES:${escapeText(category)}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
