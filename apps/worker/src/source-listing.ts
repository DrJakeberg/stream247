// How a YouTube or Twitch source is listed for a sync, and which publish date a listing entry carries.
//
// The listing is `yt-dlp --flat-playlist`: one request per source, no per-video page. Measured on the
// DUT 2026-10-01, a flat YouTube channel or playlist tab reports neither `timestamp` nor `upload_date`
// unless it is asked for `youtubetab:approximate_date`; with it the entries carry an approximate date
// (`upload_date` such as 20260701). yt-dlp sets `timestamp` itself from YouTube's relative text
// (extractor/youtube.py `_parse_time_text`): it counts back from the time of the request and rounds
// to the unit of that text, so "5 hours ago" gives an hour, "3 months ago" a day that every item with
// that label shares, and `upload_date` is derived from it. The value moves on every sync; the db keeps
// the first one it sees (chooseStoredAssetSyncFields). Twitch flat archive entries have no date at
// all: their order comes from the VOD id (packages/core/src/programming-asset-order.ts), so they get
// no extractor argument.

export type FlatListingConnectorKind = "youtube-playlist" | "youtube-channel" | "twitch-channel";

export type FlatListingEntryDates = {
  timestamp?: number;
  upload_date?: string;
};

export function buildFlatListingArgs(args: {
  url: string;
  connectorKind: FlatListingConnectorKind;
  playlistEnd: string;
}): string[] {
  const extractorArgs =
    args.connectorKind === "youtube-playlist" || args.connectorKind === "youtube-channel"
      ? ["--extractor-args", "youtubetab:approximate_date"]
      : [];
  return ["--flat-playlist", "--dump-single-json", "--playlist-end", args.playlistEnd, ...extractorArgs, args.url];
}

/**
 * The entry's publish date as an ISO string, or undefined when the listing has none.
 *
 * `timestamp` wins when present; with `approximate_date` yt-dlp sets it for every YouTube tab entry
 * that shows a relative age. `upload_date` (YYYYMMDD) is the fallback for an entry that has only the day, read as UTC
 * midnight: it is a calendar day without a time zone, and UTC keeps the value the same on every host.
 */
export function resolveListingEntryPublishedAt(entry: FlatListingEntryDates): string | undefined {
  if (typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)) {
    return new Date(entry.timestamp * 1000).toISOString();
  }

  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(typeof entry.upload_date === "string" ? entry.upload_date.trim() : "");
  if (!match) {
    return undefined;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls 20260231 over into March; a day that does not exist is not a date.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date.toISOString();
}
