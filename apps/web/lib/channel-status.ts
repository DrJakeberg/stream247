import { viewerText, type ViewerLocale } from "@stream247/core";

export type ChannelStatusKind = "onAir" | "startingUp" | "offAir";

/**
 * What a viewer is told the channel is doing.
 *
 * The public page rendered the playout's own status value — "running", "reconnecting", "degraded",
 * "switching". Those are the words the process uses about itself, and they leaked straight onto a
 * page meant for people who just want to know whether there is something to watch. Several of them
 * are alarming without being actionable: "degraded" still means a picture is going out.
 *
 * Three answers cover what a viewer can act on. Everything else is the channel's business.
 *
 * Takes a plain string rather than the status union: the public snapshot carries it loosely, and a
 * value this build does not recognise — an older worker, a newer one — should land on "Off air"
 * rather than reach the page unmapped.
 */
export function getChannelStatusKind(status: string): ChannelStatusKind {
  switch (status) {
    case "running":
    case "switching":
    // Degraded is an internal quality judgement — from the sofa it is still a channel that plays.
    case "degraded":
      return "onAir";
    case "starting":
    case "recovering":
    case "reconnecting":
      return "startingUp";
    default:
      return "offAir";
  }
}

// The admin's copy of the three answers. The control room, the status rail and the asset page use
// the same plain words, and the admin stays English (M81) whatever language the channel speaks, so
// these are not catalogue lookups: a German channel's operator still reads "On air" here.
const ADMIN_CHANNEL_STATUS_LABELS: Readonly<Record<ChannelStatusKind, string>> = {
  onAir: "On air",
  startingUp: "Starting up",
  offAir: "Off air"
};

/** The status in the admin interface (English). Viewers get getViewerChannelStatusLabel. */
export function getChannelStatusLabel(status: string): string {
  return ADMIN_CHANNEL_STATUS_LABELS[getChannelStatusKind(status)];
}

/** The same three answers on the public page, in the channel language (M80). */
export function getViewerChannelStatusLabel(locale: ViewerLocale, status: string): string {
  return viewerText(locale, `channel.status.${getChannelStatusKind(status)}`);
}

/**
 * The line under "On air now" when no schedule block covers the hour. It printed the playout's
 * status message, which the worker writes for the operator ("Crash-loop protection is active.",
 * "FFmpeg exited repeatedly. Manual intervention is required..."), in English, on every channel.
 * The viewer gets the state in their own words instead; the message stays on the admin pages.
 */
export function getViewerChannelStatusLine(locale: ViewerLocale, status: string): string {
  return viewerText(locale, `channel.statusLine.${getChannelStatusKind(status)}`);
}

/**
 * Whether to tell the viewer their page is updating more slowly than usual.
 *
 * The page said "Live updates connected" the rest of the time, which is the normal case and
 * therefore not worth a line — and "Polling fallback active" when it was not, which names the
 * mechanism rather than the effect. Silence when things are normal; a plain sentence when they are
 * not.
 */
export function getChannelUpdateNotice(locale: ViewerLocale, connected: boolean): string {
  return connected ? "" : viewerText(locale, "channel.updateNotice");
}
