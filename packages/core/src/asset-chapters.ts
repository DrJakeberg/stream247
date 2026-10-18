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

/**
 * One chapter of one window, by what it says, not only where it starts (M108): a recheck may replace
 * a list while its item is on air, and the stand-in's [0 WARDOGS] becoming [0 Just Chatting, 3600
 * WARDOGS] in the first hour keeps offset 0 but changes what is on air. Keyed on the offset alone,
 * the new chapter would count as announced and the log would never show it (review of 2026-10-06).
 */
export function buildAssetChapterKey(
  windowKey: string,
  chapter: Pick<AssetChapter, "offsetSeconds" | "categoryName" | "title">
): string {
  return `${windowKey}#${JSON.stringify([Math.max(0, Math.floor(chapter.offsetSeconds)), chapter.categoryName, chapter.title])}`;
}

/**
 * Which chapter boundary to announce now: at most one, the chapter the playback is in.
 *
 * Pure over elapsed seconds, the chapter list and the fired set, mirroring getCuepointProgress one
 * level down (offset within the asset instead of within the schedule block). Every boundary that has
 * been crossed is marked fired, but only the chapter containing the elapsed offset is returned, and
 * only when it was not announced before, with the same category and title.
 *
 * Until M108 every crossed boundary that was not in the fired set fired, in offset order. The fired
 * set lives in worker memory, so whenever it does not know the past — chapters that arrive for the
 * item on air mid-item (a probe lands, or replaces a list), a worker restart mid-item — every
 * boundary between offset 0 and now fired in one cycle: seen on the DUT 2026-10-06 as a burst of
 * `playout.chapter.boundary` lines for chapters that had ended hours before. Only the current
 * chapter describes what is on air. The same holds when two boundaries pass within one cycle (a
 * stall, a slow cycle, a chapter shorter than a cycle): the earlier chapter is already over, and
 * announcing it would name a game that is no longer being played; the Twitch sync reads the
 * current chapter by elapsed time anyway, so the event log is the only place an earlier one would
 * show. One boundary passing per cycle, the normal case, is unchanged.
 */
export function getDueAssetChapterBoundaries(args: {
  windowKey: string;
  chapters: AssetChapter[];
  firedChapterKeys: string[];
  elapsedSeconds: number;
}): { dueChapters: AssetChapter[]; firedChapterKeys: string[] } {
  const fired = new Set(args.firedChapterKeys);
  const crossed = normalizeAssetChapters(args.chapters).filter((chapter) => chapter.offsetSeconds <= args.elapsedSeconds);
  const current = crossed.at(-1);
  const dueChapters =
    current && !fired.has(buildAssetChapterKey(args.windowKey, current)) ? [current] : [];

  for (const chapter of crossed) {
    fired.add(buildAssetChapterKey(args.windowKey, chapter));
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
 * How far a probe-filled chapter list has settled (M108), stored per asset.
 *
 * yt-dlp's Twitch extractor (`_extract_chapters`, yt-dlp 2026.08.19 in the playout image) makes up
 * one chapter named after the VOD's current game whenever Twitch returns no chapter list ("moments")
 * — while the VOD is still being recorded, before Twitch has computed them, on a throttled answer,
 * or for a stream that stayed in one game — and yt-dlp stretches it from 0 to the end. On the DUT
 * 2026-10-06, 41 of 46 Twitch archives held one chapter at offset 0, filled by early probes and kept
 * forever.
 * Such an answer is provisional, and so is anything yt-dlp says about a VOD it marks `is_live`.
 *
 * The level counts the answers taken after the recording ended that produced, replaced or repeated
 * the stored list. An empty or shorter answer, which keeps the stored list, does not count, nor does
 * a failed probe: neither says anything about the list, and counting them would let a throttled
 * hour or a broken extractor make a partial list final (review of 2026-10-06). They count towards
 * CHAPTER_PROBE_RECHECK_CAP instead, which ends the rechecks of a source that never answers properly.
 * - 0: no such answer backs the list yet: it was taken while the VOD was still being recorded, or
 *   stored before M108, when nobody noted whether the VOD was still being recorded. Provisional
 *   whatever its shape, an empty list included.
 * - 1, 2: that many finished answers produced or replaced it. A single chapter at offset 0 stays
 *   provisional; any other list is final.
 * - 3 (settled): a finished answer repeated a list that a finished answer had produced (two in a
 *   row agree), or the third finished answer that produced or replaced it came in. The cap bounds
 *   a list whose answers keep changing.
 * Rows from before M108 read 0 rather than 1 (review of 2026-10-06): the 41 DUT lists were filled
 * by early probes, some perhaps while their VOD was still being recorded, and a longer list taken
 * then would be final at 1. At 0 every such list is asked once more (a single chapter twice), a few
 * dozen probes behind new items; losing the value in a write errs the same way.
 */
export const CHAPTER_PROBE_SETTLED_LEVEL = 3;
export const DEFAULT_CHAPTER_PROBE_SETTLE_LEVEL = 0;

export function normalizeChapterProbeSettleLevel(value: unknown): number {
  // Number(null) and Number("") read 0, which is also the default; only a real number counts.
  const level = value === null || value === undefined || value === "" ? Number.NaN : Math.trunc(Number(value));
  return Number.isFinite(level)
    ? Math.min(CHAPTER_PROBE_SETTLED_LEVEL, Math.max(0, level))
    : DEFAULT_CHAPTER_PROBE_SETTLE_LEVEL;
}

/**
 * How many counted rechecks a stored, probe-filled chapter list gets before it is treated as settled
 * whatever its level (M108 gate, 2026-10-06). An empty or shorter answer and a failed probe keep the
 * list and its level, so without a cap a source that never answers properly (a broken extractor, a
 * deleted VOD) would cost a yt-dlp call every interval for as long as the archive is listed, from the
 * address the Twitch archives are also played from.
 *
 * Counted is every recheck of a non-empty list that came back finished (the same list, a replacing,
 * an empty or a shorter one) or failed. Not counted are answers yt-dlp marks as recording and failures
 * while a recording answer is still possible (isRecordingAnswerPossible): the 48-hour window bounds
 * those already. The first probe of an empty list and the weekly empty-answer recheck do not count
 * either; a probe that fills an empty list starts the count anew.
 *
 * Six: the longest legitimate chain is three finished answers, since each one that replaces or
 * repeats the list raises its level and the third reaches CHAPTER_PROBE_SETTLED_LEVEL (three
 * replacements; or the confirmations, which get there sooner). The other three are room for as many
 * answers that say nothing (a throttled hour, an extractor hiccup), so a list one bad answer away
 * from settling still gets there. A source that answers six times after its recording window
 * without settling the list never answers properly. At the two-hour interval the six rechecks span
 * ten hours from the first, which for a list stored before M108 comes right after the upgrade (its
 * probe time is old), and twelve hours from the probe that filled a list since.
 */
export const CHAPTER_PROBE_RECHECK_CAP = 6;

export function normalizeChapterProbeRechecks(value: unknown): number {
  const count = value === null || value === undefined || value === "" ? Number.NaN : Math.trunc(Number(value));
  return Number.isFinite(count) ? Math.min(CHAPTER_PROBE_RECHECK_CAP, Math.max(0, count)) : 0;
}

/**
 * Twitch ends a broadcast after 48 hours at the latest, and an archive appears in the channel's
 * listing only once its broadcast has started, so the asset's first-seen time (`createdAt`, which a
 * sync never moves) is no earlier than the start of the recording.
 */
export const TWITCH_MAX_BROADCAST_SECONDS = 48 * 60 * 60;

/**
 * Whether a probe's "still being recorded" can be true: only within the longest broadcast after the
 * asset was first listed.
 *
 * yt-dlp 2026.08.19 (`_extract_info_gql`) sets `is_live` for an archive whose preview is Twitch's
 * "404_processing" picture. That is a heuristic (it misfired for highlights until yt-dlp issue
 * 14455): a finished archive whose preview stayed that picture would read as recording, stay at
 * level 0 and be asked again every interval for as long as it is listed (review of 2026-10-06). An
 * unreadable time cannot bound anything, so it counts as finished, like a payload without the field.
 */
export function isRecordingAnswerPossible(args: { listedAt: string | undefined; probedAt: string }): boolean {
  const listedAtMs = Date.parse(args.listedAt ?? "");
  const probedAtMs = Date.parse(args.probedAt);
  if (!Number.isFinite(listedAtMs) || !Number.isFinite(probedAtMs)) {
    return false;
  }
  return probedAtMs - listedAtMs <= TWITCH_MAX_BROADCAST_SECONDS * 1000;
}

/** The shape of yt-dlp's no-chapter-list stand-in: exactly one chapter, starting at 0. */
export function isSingleOpeningChapterList(chapters: AssetChapter[]): boolean {
  return chapters.length === 1 && chapters[0]?.offsetSeconds === 0;
}

/**
 * Whether a probe-filled list should be asked about again. The caller decides that the list was
 * filled by the probe (status "ok", never an operator edit) and that the source's chapter titles
 * name the category (Twitch archives); this only reads the list, its settle level and its counted
 * rechecks. An empty list is the empty-answer recheck's business, except at level 0 (see
 * classifyProbeDisposition). A list whose rechecks reached CHAPTER_PROBE_RECHECK_CAP is settled.
 */
export function isProvisionalProbedChapterList(
  chapters: AssetChapter[],
  settleLevel: number | undefined,
  rechecks?: number
): boolean {
  if (chapters.length === 0 || normalizeChapterProbeRechecks(rechecks) >= CHAPTER_PROBE_RECHECK_CAP) {
    return false;
  }
  const level = normalizeChapterProbeSettleLevel(settleLevel);
  if (level === 0) {
    return true;
  }
  return isSingleOpeningChapterList(chapters) && level < CHAPTER_PROBE_SETTLED_LEVEL;
}

function sameChapterList(left: AssetChapter[], right: AssetChapter[]): boolean {
  return JSON.stringify(normalizeAssetChapters(left)) === JSON.stringify(normalizeAssetChapters(right));
}

/**
 * The list and settle level after a completed probe answer. `recording` is the answer's own word,
 * already bounded by isRecordingAnswerPossible.
 *
 * - An empty stored list takes the answer as it is (the first probe, an empty recheck); an empty
 *   answer of a VOD still being recorded stays at level 0, so it is asked again within hours, not
 *   after the week an empty answer of a finished VOD waits.
 * - A stored list is replaced only by a different answer at least as long: a longer list is the
 *   whole chapter list the stand-in stood for, and an answer of the same length is the newer word
 *   (a recording VOD's game moved on). yt-dlp drops chapters on a bad answer but never invents more
 *   of them, so an empty or shorter answer never wipes what is stored.
 * - A recording answer leaves the list at level 0. A finished answer that repeats the stored list
 *   settles it when a finished answer had produced it (level 1 or more), and raises a list taken
 *   while recording to 1; a finished answer that replaces the list moves one step towards the cap.
 *   An empty or shorter finished answer keeps the level, like a failed probe: it neither confirms
 *   nor replaces anything.
 */
export function resolveChapterProbeAnswer(args: {
  stored: AssetChapter[];
  settleLevel: number;
  answer: AssetChapter[];
  recording: boolean;
}): { chapters: AssetChapter[]; settleLevel: number } {
  const stored = normalizeAssetChapters(args.stored);
  const answer = normalizeAssetChapters(args.answer);
  const level = normalizeChapterProbeSettleLevel(args.settleLevel);

  if (stored.length === 0) {
    return { chapters: answer, settleLevel: args.recording ? 0 : 1 };
  }

  const same = sameChapterList(stored, answer);
  const replaces = !same && answer.length > 0 && answer.length >= stored.length;
  if (args.recording) {
    return { chapters: replaces ? answer : stored, settleLevel: 0 };
  }
  if (same) {
    return { chapters: stored, settleLevel: level >= 1 ? CHAPTER_PROBE_SETTLED_LEVEL : 1 };
  }
  if (replaces) {
    return { chapters: answer, settleLevel: Math.min(CHAPTER_PROBE_SETTLED_LEVEL, level + 1) };
  }
  return { chapters: stored, settleLevel: level };
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
