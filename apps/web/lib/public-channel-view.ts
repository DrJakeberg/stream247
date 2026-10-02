import { localizeViewerBuiltInText, viewerText, type ViewerLocale } from "@stream247/core";
import { getChannelUpdateNotice, getViewerChannelStatusLabel, getViewerChannelStatusLine } from "@/lib/channel-status";
import type { LiveScheduleSummary, PublicChannelSnapshot } from "@/lib/live-broadcast";

/**
 * Everything the public page /channel says, in the channel language (M80).
 *
 * The page and its live component only lay these strings out; every word comes from here, so the
 * German page and the English one are one function apart and a test can read both without a
 * browser. The admin interface stays English (M81) and never uses this.
 */

export type PublicChannelHeader = {
  /** The `lang` of the page's content. The root layout's <html lang="en"> also serves the admin. */
  lang: ViewerLocale;
  badge: string;
  heading: string;
  timeZoneNote: string;
  lineupTitle: string;
  lineupEyebrow: string;
};

export type PublicChannelView = {
  lang: ViewerLocale;
  statusLabel: string;
  updateNotice: string;
  timeZoneLabel: string;
  watchLabel: string;
  onAirHeading: string;
  onAirTitle: string;
  onAirDetail: string;
  nextHeading: string;
  nextTitle: string;
  nextDetail: string;
  afterHeading: string;
  afterText: string;
};

export function buildPublicChannelHeader(locale: ViewerLocale, timeZoneLabel: string): PublicChannelHeader {
  return {
    lang: locale,
    badge: viewerText(locale, "channel.badge"),
    heading: viewerText(locale, "channel.heading"),
    timeZoneNote: viewerText(locale, "channel.timeZoneNote", { timeZone: timeZoneLabel }),
    lineupTitle: viewerText(locale, "channel.lineupTitle"),
    lineupEyebrow: viewerText(locale, "channel.badge")
  };
}

/** The page's meta description, which link previews show; the product's own tagline is not for viewers. */
export function buildPublicChannelDescription(locale: ViewerLocale): string {
  return viewerText(locale, "channel.heading");
}

export function buildPublicChannelView(snapshot: PublicChannelSnapshot, connected: boolean): PublicChannelView {
  const locale = snapshot.locale;
  // The same equality rule as the picture: a title or category the product wrote in English
  // ("Replay standby", "Live input") is shown in the channel language, anything the operator wrote is
  // shown as written. The worker keeps those words English in state for the admin and the as-run log.
  const viewerWords = (value: string | null | undefined) => localizeViewerBuiltInText(locale, value || "");
  const scheduleLine = (item: LiveScheduleSummary) =>
    `${viewerText(locale, "channel.timeRange", { start: item.startTime, end: item.endTime })} · ${viewerWords(item.categoryName)}`;

  return {
    lang: locale,
    statusLabel: getViewerChannelStatusLabel(locale, snapshot.playout.status),
    updateNotice: getChannelUpdateNotice(locale, connected),
    timeZoneLabel: snapshot.timeZoneLabel,
    watchLabel: viewerText(locale, "channel.watch"),
    onAirHeading: viewerText(locale, "channel.onAirNow"),
    onAirTitle:
      viewerWords(snapshot.currentScheduleItem?.title || snapshot.currentAsset?.title || snapshot.playout.currentTitle) ||
      viewerText(locale, "channel.standby"),
    onAirDetail: snapshot.currentScheduleItem
      ? scheduleLine(snapshot.currentScheduleItem)
      : getViewerChannelStatusLine(locale, snapshot.playout.status),
    nextHeading: viewerText(locale, "channel.upNext"),
    nextTitle: viewerWords(snapshot.nextScheduleItem?.title || snapshot.nextAsset?.title) || viewerText(locale, "channel.noNext"),
    nextDetail: snapshot.nextScheduleItem ? scheduleLine(snapshot.nextScheduleItem) : viewerText(locale, "channel.noNextBody"),
    // "Queue preview" is what the operators call it. This is the audience's page.
    afterHeading: viewerText(locale, "channel.afterThat"),
    // The queue when the playout has one; otherwise what the schedule airs after "up next", each with
    // its start, so an idle queue no longer reads as an empty programme.
    afterText:
      snapshot.queueItems.length > 0
        ? snapshot.queueItems
            .slice(0, 4)
            .map((item) => viewerWords(item.title))
            .join(" → ")
        : (snapshot.laterScheduleItems ?? []).length > 0
          ? (snapshot.laterScheduleItems ?? [])
              .map((item) => `${item.startTime} ${viewerWords(item.title || item.categoryName)}`)
              .join(" → ")
          : viewerText(locale, "channel.nothingFurther")
  };
}
