// What the chat bot answers to !now and !next (M104), from the state the worker cycle reads.
//
// The worker process holds the chat connection, the playout process plays: the bot answers from the
// playout row the playout writes (its current and next title) and, while nothing plays, from the
// schedule. Built once per cycle as the fallback; since M105 an answer reads the playout row when it is
// given (readChatProgrammeInfoNow, R22), without holding up the IRC handler, which only starts the read.

import { builtInViewerTextKey, localizeViewerBuiltInText, type ChatProgrammeInfo } from "@stream247/core";

// The playout states in which something plays, as the public page counts them (apps/web/lib/channel-status.ts).
const ON_AIR_STATUSES = new Set(["running", "switching", "degraded"]);

// The worker's own titles for "nothing plays": the standby and the reconnect slate are not a programme.
const SLATE_TITLE_KEYS = new Set(["overlay.title.standby", "overlay.title.reconnect"]);

export function buildChatProgrammeInfo(args: {
  playout: { status: string; currentTitle: string; nextTitle: string };
  /** The next schedule block of today, for when nothing plays. */
  nextScheduleItem: { title: string; startTime: string } | null;
  /** APP_URL or the wizard's value, without a trailing slash; empty when none is configured. */
  appUrl: string;
  locale: string;
}): ChatProgrammeInfo {
  const { playout } = args;
  const onAir = ON_AIR_STATUSES.has(playout.status);
  const currentTitle = playout.currentTitle.trim();
  const isSlate = SLATE_TITLE_KEYS.has(builtInViewerTextKey(currentTitle) ?? "");
  const nowTitle = onAir && currentTitle && !isSlate ? localizeViewerBuiltInText(args.locale, currentTitle) : "";

  const playoutNext = playout.nextTitle.trim();
  const scheduleNext = args.nextScheduleItem?.title.trim() ?? "";
  const next =
    nowTitle && playoutNext
      ? { title: localizeViewerBuiltInText(args.locale, playoutNext), startsAt: "" }
      : scheduleNext
        ? { title: localizeViewerBuiltInText(args.locale, scheduleNext), startsAt: args.nextScheduleItem?.startTime ?? "" }
        : { title: "", startsAt: "" };

  return {
    nowTitle,
    nextTitle: next.title,
    nextStartsAt: next.startsAt,
    channelUrl: args.appUrl ? `${args.appUrl.replace(/\/+$/, "")}/channel` : ""
  };
}

/** How long an answer waits for the playout row before it answers from what the last cycle read. */
export const CHAT_PROGRAMME_READ_TIMEOUT_MS = 2_000;

/**
 * What plays at the moment a viewer asks !now or !next (review finding R22). The info used to be rebuilt
 * only by the chat step, second to last in a worker cycle that can take over two minutes (source syncs,
 * Twitch), followed by 30 s of sleep: for that long after every item change !now named the previous video
 * and !next the one on air, just when viewers ask. The playout writes its titles when it starts an item, so
 * reading its row when asked is exact; the schedule's next block, for when nothing plays, is reckoned at
 * the same moment from the blocks the last cycle read. A read that fails or takes longer than `timeoutMs`
 * answers from `fallback`, as before. Never throws.
 */
export async function readChatProgrammeInfoNow(args: {
  readTitles: () => Promise<{ status: string; currentTitle: string; nextTitle: string }>;
  nextScheduleItem: () => { title: string; startTime: string } | null;
  appUrl: string;
  locale: string;
  fallback: ChatProgrammeInfo;
  timeoutMs?: number;
}): Promise<ChatProgrammeInfo> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const playout = await Promise.race([
      args.readTitles(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("playout row read timed out")), args.timeoutMs ?? CHAT_PROGRAMME_READ_TIMEOUT_MS);
      })
    ]);
    return buildChatProgrammeInfo({
      playout,
      nextScheduleItem: args.nextScheduleItem(),
      appUrl: args.appUrl,
      locale: args.locale
    });
  } catch {
    return args.fallback;
  } finally {
    clearTimeout(timer);
  }
}
