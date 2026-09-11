/**
 * How long an open incident has been standing, and what a panel is not showing.
 *
 * The incident panels listed severity, scope, title and message and nothing about time. With a
 * handful of entries that was survivable; with the forty that had accumulated by August 2026 it was
 * not, because the two questions an operator actually has in front of that list are "is this
 * happening now" and "is this the whole list". Neither had an answer on screen.
 *
 * Last-reported comes first for the same reason: an entry last reported four minutes ago is the
 * channel's current problem, one last reported six weeks ago is history, and the two look identical
 * without it. First-seen follows, because a problem that has been recurring since July is a
 * different conversation from one that started this morning.
 *
 * The compact `40d 0h` / `3h 00m` shape is the one `getBroadcastLiveUptimeLabel` already uses for
 * the live uptime chip, so the two ages on an operator's screen read the same way.
 */

function ageLabel(fromIso: string, nowMs: number): string {
  const fromMs = fromIso ? new Date(fromIso).getTime() : Number.NaN;
  // The reference clock is passed in rather than read here, because both callers render inside a
  // React component where `Date.now()` is not allowed. An unusable one says nothing at all.
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs)) {
    return "";
  }

  const elapsedMinutes = Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
  const days = Math.floor(elapsedMinutes / (60 * 24));
  const hours = Math.floor((elapsedMinutes % (60 * 24)) / 60);
  const minutes = elapsedMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "<1m";
}

export function describeIncidentAge(args: { createdAt: string; updatedAt: string; nowMs: number }): string {
  const lastReported = ageLabel(args.updatedAt || args.createdAt, args.nowMs);
  if (lastReported === "") {
    return "";
  }

  const firstSeen = ageLabel(args.createdAt, args.nowMs);
  if (firstSeen === "" || firstSeen === lastReported) {
    return `Reported ${lastReported} ago`;
  }

  return `Last reported ${lastReported} ago · first seen ${firstSeen} ago`;
}

/**
 * What a panel is hiding.
 *
 * Both incident panels cap what they render. A cap is fine; a silent cap is not, because the entry
 * an operator is looking for may be the one below the line.
 */
export function describeOpenIncidentOverflow(shown: number, total: number): string {
  const hidden = Math.max(0, total - shown);
  if (hidden === 0) {
    return "";
  }

  return `${hidden} further open incident${hidden === 1 ? " is" : "s are"} not shown here.`;
}
