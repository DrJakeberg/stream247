// The one order a pool walks its assets in. Until 2.1 three hand-copied sorts (schedule preview,
// materialized programming window, worker selection) and the recovery ladder each compared
// `publishedAt || createdAt`, then the title. Measured on the DUT 2026-10-01 that key carried no
// information: every remote asset had `published_at = ''` and each source sync rewrote `created_at`
// to "now", so all 46 Twitch archives shared one timestamp and all 11 YouTube items another. The pool
// therefore played each source block alphabetically, and two items with the same title fell back to
// whatever order the database happened to return them in.
//
// Since M72 the sync keeps the first-seen `created_at` and the first observed `published_at`, and this
// comparator adds the tiebreaks the data can actually support, as one fixed key compared left to right:
//   1. `publishedAt || createdAt`, oldest first (an unparsable date sorts last);
//   2. the source id, so items with the same date stay grouped by source;
//   3. within that source, items with a numeric VOD id before items without one, then the VOD id.
//      Twitch flat archive listings carry no date at all, but Twitch VOD ids are a global increasing
//      sequence, so the id IS the upload order. Ids are 10+ digits ("2887855611"), compared as digit
//      strings, never as Number;
//   4. the title;
//   5. the asset id, so the order no longer depends on the database's read order.
//
// The key has to be fixed. A first draft compared VOD ids only for same-source pairs and titles for
// everything else; with equal dates that cycles (A < B by id, B < C by title, C < A by title), and
// Array.sort then returns an order that depends on the input. The input is `ORDER BY updated_at DESC`,
// which every sync and every cache peek reshuffles, and several sources do share one date: one Twitch
// sync pass stamps all its channels with the same `now`, and all 46 Twitch rows on the DUT kept one
// `created_at` from their last 2.0 sync. Grouping equal dates by source loses nothing, because the
// title interleaving across sources meant nothing either.

export type ProgrammingOrderAsset = {
  id: string;
  sourceId: string;
  title: string;
  externalId?: string;
  publishedAt?: string;
  createdAt: string;
};

function orderTimeOf(asset: ProgrammingOrderAsset): number {
  const time = new Date(asset.publishedAt || asset.createdAt).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

/**
 * The digits of a numeric VOD id, without a leading "v" or leading zeros; null for anything else.
 *
 * The twitch-channel sync stores the id without its "v" while a single twitch-vod source stores what
 * yt-dlp reports ("v2887855611"), so both spellings have to land on the same digits.
 */
export function parseNumericVodId(externalId: string | undefined): string | null {
  const match = /^v?(\d+)$/i.exec((externalId ?? "").trim());
  return match ? match[1].replace(/^0+(?=\d)/, "") : null;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareDigitStrings(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return compareCodeUnits(left, right);
}

export function compareProgrammingAssets(left: ProgrammingOrderAsset, right: ProgrammingOrderAsset): number {
  const leftTime = orderTimeOf(left);
  const rightTime = orderTimeOf(right);
  if (leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }

  // Source ids are opaque, so code units: there is nothing to collate.
  const sourceDelta = compareCodeUnits(left.sourceId, right.sourceId);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }

  // Ids are only ever compared inside one source (the step above already split the sources): a
  // YouTube id that happens to be all digits, or a VOD from another channel, says nothing about where
  // it sits in this source's sequence. An item without a numeric id goes after those with one; letting
  // it fall to the title against them would bring the cycle back inside one source.
  const leftVodId = parseNumericVodId(left.externalId);
  const rightVodId = parseNumericVodId(right.externalId);
  if ((leftVodId === null) !== (rightVodId === null)) {
    return leftVodId === null ? 1 : -1;
  }
  if (leftVodId !== null && rightVodId !== null) {
    const vodDelta = compareDigitStrings(leftVodId, rightVodId);
    if (vodDelta !== 0) {
      return vodDelta;
    }
  }

  const titleDelta = left.title.localeCompare(right.title);
  if (titleDelta !== 0) {
    return titleDelta;
  }

  return compareCodeUnits(left.id, right.id);
}

export function sortProgrammingAssets<T extends ProgrammingOrderAsset>(assets: readonly T[]): T[] {
  return assets.slice().sort(compareProgrammingAssets);
}
