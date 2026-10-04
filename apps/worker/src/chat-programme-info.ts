// What the chat bot answers to !now and !next (M104), from the state the worker cycle reads.
//
// The worker process holds the chat connection, the playout process plays: the bot answers from the
// playout row the playout writes (its current and next title) and, while nothing plays, from the
// schedule. Built once per cycle so the IRC handler, which must not wait on the database, only reads it.

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
