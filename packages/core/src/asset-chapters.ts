// Chapters inside a single video.
//
// A VOD of a long stream is not one programme item: the streamer switches games, and Twitch
// records those switches as chapters. Each chapter carries the category and the stream title that
// should be live while that part of the video plays out, so the broadcast channel can follow the
// original stream instead of announcing one category for six hours of changing content.
//
// Everything here is pure over (chapter list, elapsed seconds, fired set) for the same reason the
// cuepoint machinery is: boundary decisions must be testable without a clock, a database, or a
// playout process. An empty chapter list means the asset behaves exactly as it did before this
// feature existed — that is the documented rollback path, so normalisation may drop entries but
// must never invent them.

// Kept in sync with the shared invisible-character strip in index.ts; duplicated here because the
// core barrel re-exports this module, and importing the barrel from inside it would be a cycle.
const invisibleUnicodePattern =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function sanitizeChapterText(value: unknown, maxLength: number): string {
  return String(value ?? "").normalize("NFC").replace(invisibleUnicodePattern, "").trim().slice(0, maxLength);
}

export type AssetChapter = {
  /** Seconds into the asset at which this chapter starts. The first chapter usually sits at 0. */
  offsetSeconds: number;
  /** Twitch category to apply from this offset on. Empty keeps the asset-level category. */
  categoryName: string;
  /** Stream title to apply from this offset on. Empty keeps the asset-level title. */
  title: string;
};

// Bounds chosen from what the values feed into: the title becomes part of a Helix channel title
// (140 chars there, but stored at asset-title width so editing round-trips), the category goes
// through the same 120-char normalisation as the asset category, and 200 chapters covers a
// multi-day marathon VOD without letting a corrupt payload store unbounded rows.
const MAX_CHAPTER_TITLE_LENGTH = 200;
const MAX_CHAPTER_CATEGORY_LENGTH = 120;
const MAX_CHAPTERS_PER_ASSET = 200;

/**
 * Normalise an untrusted chapter list into the stored shape.
 *
 * Sorted by offset, negatives and non-numbers dropped, duplicate offsets collapsed to the first
 * occurrence (two chapters cannot start at the same second — one of them would never be on air),
 * and entries with neither a title nor a category dropped because they could never change
 * anything at their boundary. Anything unparseable normalises to the empty list, which is the
 * rollback behaviour rather than an error.
 */
export function normalizeAssetChapters(value: unknown): AssetChapter[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const candidates = value
    .map((entry) => {
      const record = (entry ?? {}) as { offsetSeconds?: unknown; categoryName?: unknown; title?: unknown };
      return {
        offsetSeconds: Math.floor(Number(record.offsetSeconds)),
        categoryName: sanitizeChapterText(record.categoryName, MAX_CHAPTER_CATEGORY_LENGTH),
        title: sanitizeChapterText(record.title, MAX_CHAPTER_TITLE_LENGTH)
      };
    })
    .filter((entry) => Number.isFinite(entry.offsetSeconds) && entry.offsetSeconds >= 0)
    .filter((entry) => entry.title !== "" || entry.categoryName !== "");

  const seenOffsets = new Set<number>();
  return candidates
    .sort((left, right) => left.offsetSeconds - right.offsetSeconds)
    .filter((entry) => {
      if (seenOffsets.has(entry.offsetSeconds)) {
        return false;
      }
      seenOffsets.add(entry.offsetSeconds);
      return true;
    })
    .slice(0, MAX_CHAPTERS_PER_ASSET);
}

export function parseAssetChaptersJson(value: string | undefined): AssetChapter[] {
  try {
    return normalizeAssetChapters(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

export function serializeAssetChapters(value: unknown): string {
  return JSON.stringify(normalizeAssetChapters(value));
}

/**
 * The chapter that should be on air after `elapsedSeconds` of the asset — the last one whose
 * offset has been reached. Before the first offset (or with no chapters) nothing applies and the
 * asset-level metadata stays authoritative, so callers get null rather than a synthetic chapter.
 */
export function getAssetChapterAt(chapters: AssetChapter[], elapsedSeconds: number): AssetChapter | null {
  let active: AssetChapter | null = null;
  for (const chapter of normalizeAssetChapters(chapters)) {
    if (chapter.offsetSeconds > elapsedSeconds) {
      break;
    }
    active = chapter;
  }

  return active;
}

/**
 * One playback of one asset is one boundary window.
 *
 * The playout restarts an asset from second zero whenever its process restarts, so elapsed time —
 * and with it every chapter boundary — starts over. Keying the fired set on (asset, process start)
 * makes that reset automatic: a new window key means a new, empty fired set, without anyone having
 * to clear the old one.
 */
export function buildAssetChapterWindowKey(assetId: string, processStartedAt: string): string {
  return `${assetId}@${processStartedAt}`;
}

export function buildAssetChapterKey(windowKey: string, offsetSeconds: number): string {
  return `${windowKey}#${Math.max(0, Math.floor(offsetSeconds))}`;
}

/**
 * Which chapter boundaries have been crossed but not yet announced.
 *
 * Pure over elapsed seconds, the chapter list and the fired set, mirroring getCuepointProgress one
 * level down (offset within the asset instead of within the schedule block). All overdue chapters
 * are returned in offset order rather than one per call: after a stall or a slow cycle several
 * boundaries can pass between two checks, and each of them deserves its runtime event even though
 * only the last one still describes what is on air.
 */
export function getDueAssetChapterBoundaries(args: {
  windowKey: string;
  chapters: AssetChapter[];
  firedChapterKeys: string[];
  elapsedSeconds: number;
}): { dueChapters: AssetChapter[]; firedChapterKeys: string[] } {
  const fired = new Set(args.firedChapterKeys);
  const dueChapters = normalizeAssetChapters(args.chapters).filter(
    (chapter) =>
      chapter.offsetSeconds <= args.elapsedSeconds && !fired.has(buildAssetChapterKey(args.windowKey, chapter.offsetSeconds))
  );

  for (const chapter of dueChapters) {
    fired.add(buildAssetChapterKey(args.windowKey, chapter.offsetSeconds));
  }

  return { dueChapters, firedChapterKeys: [...fired] };
}

/**
 * Map source-provided chapter metadata (the yt-dlp `chapters` array) into stored chapters.
 *
 * Twitch VOD chapters are named after the game being played, so there the chapter title doubles as
 * the category candidate; YouTube chapter titles are free text and would resolve to no Helix
 * category, so they fill only the title. The category stays a *candidate* by name — resolution to
 * a category id happens at sync time like it always has for the asset-level category.
 */
export function buildAssetChaptersFromSourceMetadata(
  entries: Array<{ start_time?: number; title?: string }> | undefined,
  options: { chapterTitleNamesCategory: boolean }
): AssetChapter[] {
  return normalizeAssetChapters(
    (entries ?? []).map((entry) => ({
      offsetSeconds: entry.start_time ?? Number.NaN,
      categoryName: options.chapterTitleNamesCategory ? entry.title ?? "" : "",
      title: entry.title ?? ""
    }))
  );
}

/**
 * Parse an operator-typed chapter offset: plain seconds, mm:ss, or hh:mm:ss.
 *
 * Returns null instead of guessing when the input does not parse, so the editor can hold the row
 * open with a validation message rather than silently storing an offset the operator never meant.
 */
export function parseChapterOffsetInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = /^(?:(\d{1,3}):)?([0-5]?\d):([0-5]\d)$/.exec(trimmed);
  if (!match) {
    return null;
  }

  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}
