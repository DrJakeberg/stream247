import { getScheduleInstant, type MaterializedProgrammingDay } from "@stream247/core";

/**
 * The public programme (M100): what /channel and /channel.ics show viewers, at item level.
 *
 * Built from the week projection the Program week view uses (`buildMaterializedProgrammingWeek`, which
 * walks each pool with the worker's own rotation), so the page names the videos the channel will play
 * rather than its own guess. Every time is an instant (ISO, UTC): the page writes it in the viewer's
 * zone and the channel's (owner default R2 Q7), the calendar feed as UTC.
 */

export type PublicProgrammeItem = {
  title: string;
  startsAt: string;
  endsAt: string;
};

/** Consecutive items of one block: shown as its next item with "N more" (the rest in `items`). */
export type PublicProgrammeGroup = {
  key: string;
  /** The block's title, or its category when it has none. */
  title: string;
  categoryName: string;
  /** The block has dates of its own (M93), not every week. */
  dated: boolean;
  /** The first item's times, or the block's air window when it has nothing to play. */
  startsAt: string;
  endsAt: string;
  /** Its items in the next 24 hours, at most `PUBLIC_PROGRAMME_GROUP_ITEMS` of them listed. */
  items: PublicProgrammeItem[];
  /** How many there are, listed or not ("N more" is this minus one). */
  itemCount: number;
};

/** What is on now: the item the playout runs, or, without one, the block the schedule has now. */
export type PublicProgrammeNow = {
  kind: "item" | "block";
  title: string;
  categoryName: string;
  startsAt: string;
  endsAt: string;
};

/** One block's air window in the coming week. A weekly block cut by a dated block has two. */
export type PublicProgrammeWeekEntry = {
  key: string;
  title: string;
  categoryName: string;
  dated: boolean;
  startsAt: string;
  endsAt: string;
};

export type PublicProgramme = {
  now: PublicProgrammeNow | null;
  next: PublicProgrammeGroup[];
  week: PublicProgrammeWeekEntry[];
};

/** The item the playout has on air, as the snapshot knows it. */
export type PublicProgrammeCurrentItem = {
  title: string;
  categoryName: string;
  startsAt: string;
  endsAt: string;
};

export const PUBLIC_PROGRAMME_NEXT_HOURS = 24;
/**
 * Items listed per group. A 24 h block of short clips has hundreds in a day, and the page is pushed to every
 * open tab every few seconds; the count stays exact.
 */
export const PUBLIC_PROGRAMME_GROUP_ITEMS = 25;

type BlockEntry = {
  key: string;
  title: string;
  categoryName: string;
  dated: boolean;
  /** Air windows as instants (ms). */
  windows: { start: number; end: number }[];
  items: { title: string; start: number; end: number }[];
};

function collectBlocks(days: MaterializedProgrammingDay[], timeZone: string): BlockEntry[] {
  const blocks: BlockEntry[] = [];
  for (const day of days) {
    for (const block of day.blocks) {
      if (block.aired) {
        continue;
      }
      const date = block.date || day.date;
      const at = (minute: number) => getScheduleInstant({ date, seconds: minute * 60, timeZone }).getTime();
      const windows = (block.airWindows && block.airWindows.length > 0
        ? block.airWindows
        : [{ start: block.startMinuteOfDay, end: block.startMinuteOfDay + block.durationMinutes }]
      ).map((window) => ({ start: at(window.start), end: at(window.end) }));
      blocks.push({
        key: `${block.blockId}:${date}`,
        title: block.title || block.categoryName,
        categoryName: block.categoryName,
        dated: Boolean(block.dated),
        windows,
        items: block.items
          .filter((item) => typeof item.startSecond === "number" && typeof item.endSecond === "number")
          .map((item) => ({
            title: item.title,
            start: getScheduleInstant({ date, seconds: item.startSecond as number, timeZone }).getTime(),
            end: getScheduleInstant({ date, seconds: item.endSecond as number, timeZone }).getTime()
          }))
      });
    }
  }
  return blocks.sort((left, right) => (left.windows[0]?.start ?? 0) - (right.windows[0]?.start ?? 0));
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Now, the next 24 hours item by item, and the week block by block.
 *
 * The week projection starts the block on air from the current minute: its first item is the one after the
 * item on air (the pool has moved on when the playout picked it), so with `current` its items are moved to
 * start when the current item ends. Items are kept from the start of the current minute on, so the first
 * of a block on air without a playout (it starts "now") is listed.
 */
export function buildPublicProgramme(args: {
  days: MaterializedProgrammingDay[];
  timeZone: string;
  now: Date;
  current?: PublicProgrammeCurrentItem | null;
  nextHours?: number;
}): PublicProgramme {
  const nowMs = args.now.getTime();
  const fromMs = nowMs - (nowMs % 60_000);
  const horizonMs = nowMs + (args.nextHours ?? PUBLIC_PROGRAMME_NEXT_HOURS) * 3_600_000;
  const blocks = collectBlocks(args.days, args.timeZone);
  const onAir = blocks.find((block) => block.windows.some((window) => window.start <= nowMs && nowMs < window.end)) ?? null;

  const currentEnd = args.current ? Date.parse(args.current.endsAt) : Number.NaN;
  if (onAir && Number.isFinite(currentEnd) && currentEnd > nowMs) {
    const first = onAir.items.find((item) => item.start >= fromMs);
    const shift = first ? Math.max(0, currentEnd - first.start) : 0;
    const lastEnd = Math.max(...onAir.windows.map((window) => window.end));
    onAir.items = onAir.items
      .map((item) => (item.start >= fromMs ? { ...item, start: item.start + shift, end: item.end + shift } : item))
      .filter((item) => item.start < lastEnd);
  }

  // Items in airing order, each with its block; consecutive items of one block form a group.
  type TimelineEntry = { block: BlockEntry; item: { title: string; start: number; end: number } | null; start: number; end: number };
  const timeline: TimelineEntry[] = blocks
    .flatMap((block): TimelineEntry[] => {
      if (block.items.length > 0) {
        return block.items
          .filter((item) => item.start >= fromMs && item.start < horizonMs)
          .map((item) => ({ block, item, start: item.start, end: item.end }));
      }
      // A block with nothing to play is still on the programme: listed by its air window.
      return block.windows
        .filter((window) => window.end > nowMs && window.start < horizonMs)
        .map((window) => ({ block, item: null, start: Math.max(window.start, fromMs), end: window.end }));
    })
    .sort((left, right) => left.start - right.start);
  const groups: PublicProgrammeGroup[] = [];
  let lastBlock: BlockEntry | null = null;
  for (const entry of timeline) {
    const group = groups.at(-1);
    if (entry.item && group && lastBlock === entry.block && group.itemCount > 0) {
      group.itemCount += 1;
      if (group.items.length < PUBLIC_PROGRAMME_GROUP_ITEMS) {
        group.items.push({ title: entry.item.title, startsAt: iso(entry.start), endsAt: iso(entry.end) });
      }
      continue;
    }
    lastBlock = entry.block;
    groups.push({
      key: `${entry.block.key}@${entry.start}`,
      title: entry.block.title,
      categoryName: entry.block.categoryName,
      dated: entry.block.dated,
      startsAt: iso(entry.start),
      endsAt: iso(entry.end),
      items: entry.item ? [{ title: entry.item.title, startsAt: iso(entry.start), endsAt: iso(entry.end) }] : [],
      itemCount: entry.item ? 1 : 0
    });
  }

  const week = blocks.flatMap((block) =>
    block.windows
      .filter((window) => window.end > nowMs)
      .map((window) => ({
        key: `${block.key}@${window.start}`,
        title: block.title,
        categoryName: block.categoryName,
        dated: block.dated,
        startsAt: iso(window.start),
        endsAt: iso(window.end)
      }))
  ).sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

  const currentStart = args.current ? Date.parse(args.current.startsAt) : Number.NaN;
  const now: PublicProgrammeNow | null =
    args.current && Number.isFinite(currentStart) && currentStart <= nowMs && currentEnd > nowMs
      ? { kind: "item", ...args.current }
      : onAir
        ? (() => {
            const window = onAir.windows.find((candidate) => candidate.start <= nowMs && nowMs < candidate.end) as { start: number; end: number };
            return { kind: "block" as const, title: onAir.title, categoryName: onAir.categoryName, startsAt: iso(window.start), endsAt: iso(window.end) };
          })()
        : null;

  return { now, next: groups, week };
}
