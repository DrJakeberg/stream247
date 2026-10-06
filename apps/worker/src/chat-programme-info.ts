// What the chat bot answers to !now and !next (M104), from the state the worker cycle reads.
//
// The worker process holds the chat connection, the playout process plays: the bot answers from the
// playout row the playout writes (what plays, since when, and its queue) and the schedule, through the
// prediction the on-air Next card uses (next-on-air.ts, M107). Built once per cycle as the fallback; since
// M105 an answer reads the playout row when it is given (readChatProgrammeInfoNow, R22), without holding up
// the IRC handler, which only starts the read.

import { builtInViewerTextKey, formatViewerClock, localizeViewerBuiltInText, type ChatProgrammeInfo } from "@stream247/core";
import type { NextOnAirPlayout, NextOnAirPrediction } from "./next-on-air.js";

// The playout states in which something plays, as the public page counts them (apps/web/lib/channel-status.ts).
const ON_AIR_STATUSES = new Set(["running", "switching", "degraded"]);

// The states in which an item is on air for the prediction: the public page's, and "recovering", which the
// worker writes for every cycle of a Pin, a Fallback, the automatic global or generic fallback, and the cycle
// that starts a Move next or a scheduled insert (decideCycleEndStatus keeps the selection's status). The
// card is drawn over that item and predicts from it; !now still says "on a short break" there, as the public
// page says "starting up", but !next read it as nothing playing and named the next block where the card
// named the next video (review of M107).
const PREDICTION_ON_AIR_STATUSES = new Set([...ON_AIR_STATUSES, "recovering"]);

// The worker's own titles for "nothing plays": the standby and the reconnect slate are not a programme.
const SLATE_TITLE_KEYS = new Set(["overlay.title.standby", "overlay.title.reconnect"]);

/** The playout row's fields an answer reads (packages/db readPlayoutProgrammeTitles). */
export type ChatPlayoutRow = Omit<NextOnAirPlayout, "playing"> & { status: string; currentTitle: string };

/**
 * Whether the row has an item on air for the prediction: a programme title that is not a slate, under a
 * status in which the worker draws the on-air card (writeOnAirOverlay, which predicts with `playing: true`
 * because it is only called with the item or Live Bridge it puts on air). One rule, so the card and !next
 * name the same thing in every state the card is drawn in.
 */
export function isPlayingForPrediction(playout: Pick<ChatPlayoutRow, "status" | "currentTitle">): boolean {
  const currentTitle = playout.currentTitle.trim();
  return (
    PREDICTION_ON_AIR_STATUSES.has(playout.status) &&
    currentTitle !== "" &&
    !SLATE_TITLE_KEYS.has(builtInViewerTextKey(currentTitle) ?? "")
  );
}

/**
 * What !now and !next answer. !next names what the on-air Next card names (M107): both come from the
 * worker's one prediction (next-on-air.ts), which `predictNext` runs on this row, told whether an item is on
 * air by isPlayingForPrediction (the card's states, `recovering` included), not by !now's stricter rule. A
 * video carries the time it is expected to start, a block its start.
 */
export function buildChatProgrammeInfo(args: {
  playout: ChatPlayoutRow;
  predictNext: (playout: NextOnAirPlayout) => NextOnAirPrediction;
  /** The channel zone, for the expected start. */
  timeZone: string;
  /** APP_URL or the wizard's value, without a trailing slash; empty when none is configured. */
  appUrl: string;
  locale: string;
}): ChatProgrammeInfo {
  const { playout } = args;
  const onAir = ON_AIR_STATUSES.has(playout.status);
  const currentTitle = playout.currentTitle.trim();
  const isSlate = SLATE_TITLE_KEYS.has(builtInViewerTextKey(currentTitle) ?? "");
  const nowTitle = onAir && currentTitle && !isSlate ? localizeViewerBuiltInText(args.locale, currentTitle) : "";

  const prediction = args.predictNext({
    playing: isPlayingForPrediction(playout),
    queueKind: playout.queueKind,
    currentAssetId: playout.currentAssetId,
    processStartedAt: playout.processStartedAt,
    nextAssetId: playout.nextAssetId,
    nextTitle: playout.nextTitle,
    manualNextAssetId: playout.manualNextAssetId,
    insertAssetId: playout.insertAssetId,
    insertStatus: playout.insertStatus,
    overrideAssetId: playout.overrideAssetId,
    overrideUntil: playout.overrideUntil,
    cuepointWindowKey: playout.cuepointWindowKey
  });
  const next =
    prediction.kind === "item"
      ? {
          title: prediction.title,
          startsAt: "",
          expectedAt: prediction.startsAt ? formatViewerClock(args.locale, prediction.startsAt, args.timeZone) : ""
        }
      : prediction.kind === "block"
        ? { title: prediction.title, startsAt: prediction.block.startTime, expectedAt: "" }
        : { title: "", startsAt: "", expectedAt: "" };

  return {
    nowTitle,
    nextTitle: next.title.trim() ? localizeViewerBuiltInText(args.locale, next.title.trim()) : "",
    nextStartsAt: next.startsAt,
    nextExpectedAt: next.expectedAt,
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
 * reading its row when asked is exact; what follows it is predicted at the same moment from the schedule,
 * pools and assets the last cycle read. A read that fails or takes longer than `timeoutMs`
 * answers from `fallback`, as before. Never throws.
 */
export async function readChatProgrammeInfoNow(args: {
  readTitles: () => Promise<ChatPlayoutRow>;
  /** The prediction on the row just read, against the schedule, pools and assets the last cycle read. */
  predictNext: (playout: NextOnAirPlayout) => NextOnAirPrediction;
  timeZone: string;
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
      predictNext: args.predictNext,
      timeZone: args.timeZone,
      appUrl: args.appUrl,
      locale: args.locale
    });
  } catch {
    return args.fallback;
  } finally {
    clearTimeout(timer);
  }
}
