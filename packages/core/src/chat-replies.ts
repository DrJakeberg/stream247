// What the chat bot says back (M104).
//
// Viewers ask the bot three things -- which commands exist, what is on air, what comes next -- and
// every !request gets an answer. The texts come from the viewer catalogue in the channel language;
// the rules for how often the bot may speak live here too, so they are testable without a socket.
//
// Volume is the risk: Twitch drops a bot's lines, or holds the account back, when it writes too
// much. So the answers to !commands, !now and !next share two cooldowns (one answer per viewer a
// minute, one answer in the room every ten seconds), a request's refusal is said to a viewer at most
// once a minute and to the room at most five times in 30 seconds, and only an accepted request is
// always confirmed: requests are already throttled by their own cooldown and the queue cap.

import type { ChatInteractionConfig, RequestVerdict } from "./chat-interaction.js";
import { CHAT_INFO_COMMANDS } from "./chat-interaction.js";
import { viewerText } from "./viewer-messages/index.js";

/** One answer to !commands, !now or !next per viewer per minute. */
export const CHAT_REPLY_VIEWER_COOLDOWN_MS = 60_000;
/** At most one answer to !commands, !now or !next in the room every ten seconds. */
export const CHAT_REPLY_GLOBAL_COOLDOWN_MS = 10_000;
/**
 * At most this many request refusals in the room per window (review finding R23). The per-viewer minute
 * alone let fifteen accounts typing "!request zz" fill the bot's whole send budget with refusals, which
 * then dropped accepted requests, moderator check-ins and !game for the rest of the 30 seconds.
 */
export const CHAT_REFUSAL_ROOM_LINES = 5;
export const CHAT_REFUSAL_ROOM_WINDOW_MS = 30_000;

/**
 * The two cooldowns of the bot's answers.
 *
 * `claimInfo` is for !commands, !now and !next: it takes the viewer's minute and the room's ten
 * seconds together, or neither. `claimRefusal` is for a request's refusal: the viewer's minute and one
 * of the room's five refusals in 30 seconds, together or neither. One viewer typing a wrong title ten
 * times hears it once; other viewers' refusals are not swallowed by the info answers' ten seconds, and
 * a flood of them cannot take the lines other answers need (R23).
 */
export class ChatReplyCooldown {
  private readonly lastInfoByViewer = new Map<string, number>();
  private readonly lastRefusalByViewer = new Map<string, number>();
  private readonly roomRefusalsAtMs: number[] = [];
  private lastInfoAtMs = Number.NEGATIVE_INFINITY;

  claimInfo(actor: string, nowMs: number): boolean {
    const viewer = normalizeViewer(actor);
    if (nowMs - this.lastInfoAtMs < CHAT_REPLY_GLOBAL_COOLDOWN_MS) {
      return false;
    }
    if (nowMs - (this.lastInfoByViewer.get(viewer) ?? Number.NEGATIVE_INFINITY) < CHAT_REPLY_VIEWER_COOLDOWN_MS) {
      return false;
    }
    this.lastInfoAtMs = nowMs;
    this.lastInfoByViewer.set(viewer, nowMs);
    this.prune(this.lastInfoByViewer, nowMs);
    return true;
  }

  claimRefusal(actor: string, nowMs: number): boolean {
    const viewer = normalizeViewer(actor);
    while (this.roomRefusalsAtMs.length > 0 && nowMs - this.roomRefusalsAtMs[0]! >= CHAT_REFUSAL_ROOM_WINDOW_MS) {
      this.roomRefusalsAtMs.shift();
    }
    if (this.roomRefusalsAtMs.length >= CHAT_REFUSAL_ROOM_LINES) {
      return false;
    }
    if (nowMs - (this.lastRefusalByViewer.get(viewer) ?? Number.NEGATIVE_INFINITY) < CHAT_REPLY_VIEWER_COOLDOWN_MS) {
      return false;
    }
    this.roomRefusalsAtMs.push(nowMs);
    this.lastRefusalByViewer.set(viewer, nowMs);
    this.prune(this.lastRefusalByViewer, nowMs);
    return true;
  }

  // A busy room must not grow the maps without bound: an entry older than the cooldown decides nothing.
  private prune(map: Map<string, number>, nowMs: number): void {
    if (map.size < 500) {
      return;
    }
    for (const [viewer, atMs] of map) {
      if (nowMs - atMs >= CHAT_REPLY_VIEWER_COOLDOWN_MS) {
        map.delete(viewer);
      }
    }
  }
}

function normalizeViewer(actor: string): string {
  return actor.trim().toLowerCase();
}

/**
 * The answer to !commands: every command that answers right now, under its configured name, and
 * nothing that is switched off.
 */
export function formatChatCommandsReply(args: {
  /** Named first: Twitch drops a line identical to one the bot sent in the last 30 s, and two viewers asking get the same answer otherwise. */
  actor: string;
  config: ChatInteractionConfig;
  /** !game answers whenever chat is connected; the worker passes whether a game command is wired. */
  gameCommand: boolean;
  locale?: string;
}): string {
  const { config } = args;
  const commands: string[] = [];
  if (config.commandsReplyEnabled) {
    commands.push(`!${CHAT_INFO_COMMANDS.commands}`);
  }
  if (config.nowReplyEnabled) {
    commands.push(`!${CHAT_INFO_COMMANDS.now}`);
  }
  if (config.nextReplyEnabled) {
    commands.push(`!${CHAT_INFO_COMMANDS.next}`);
  }
  if (config.requestsEnabled) {
    commands.push(viewerText(args.locale, "chat.commands.request", { command: `!${config.requestCommand}` }));
  }
  if (config.skipEnabled) {
    commands.push(`!${config.skipCommand}`);
  }
  if (config.votingEnabled) {
    commands.push(viewerText(args.locale, "chat.commands.vote", { last: `!${String(config.voteOptionCount)}` }));
  }
  if (args.gameCommand) {
    commands.push("!game");
  }
  return viewerText(args.locale, "chat.commands.list", { actor: args.actor, commands: commands.join(" · ") });
}

/** What the bot knows about the programme when a viewer asks; the worker refreshes it every cycle. */
export type ChatProgrammeInfo = {
  /** The title on air, already in the channel language; empty while nothing plays (standby, reconnect, off air). */
  nowTitle: string;
  /** The next item's title, empty when nothing further is known. */
  nextTitle: string;
  /** "HH:MM" in the channel zone when the next title is a schedule block's start; empty for the next queued item. */
  nextStartsAt: string;
  /** The public programme page, `<app url>/channel`; empty when no app URL is configured. */
  channelUrl: string;
};

function withProgrammeLink(text: string, info: ChatProgrammeInfo, locale?: string): string {
  return info.channelUrl ? `${text} ${viewerText(locale, "chat.programmeLink", { url: info.channelUrl })}` : text;
}

/** The answer to !now, to the viewer who asked (see formatChatCommandsReply on why the name leads). */
export function formatChatNowReply(actor: string, info: ChatProgrammeInfo, locale?: string): string {
  const text = info.nowTitle
    ? viewerText(locale, "chat.now.onAir", { actor, title: info.nowTitle })
    : viewerText(locale, "chat.now.nothing", { actor });
  return withProgrammeLink(text, info, locale);
}

/** The answer to !next, always with the /channel link when one is configured. */
export function formatChatNextReply(actor: string, info: ChatProgrammeInfo, locale?: string): string {
  const text = !info.nextTitle
    ? viewerText(locale, "chat.next.nothing", { actor })
    : info.nextStartsAt
      ? viewerText(locale, "chat.next.at", { actor, time: info.nextStartsAt, title: info.nextTitle })
      : viewerText(locale, "chat.next.item", { actor, title: info.nextTitle });
  return withProgrammeLink(text, info, locale);
}

/**
 * The one answer to a !request. Null only for a verdict nobody needs to hear ("disabled": the
 * command was not parsed then). The viewer's query is never repeated: it is anonymous input, and
 * the bot saying it back would let anyone put words in its mouth.
 */
export function formatChatRequestReply(args: {
  actor: string;
  verdict: RequestVerdict;
  /** Position of the queued item in the queue, 1 = next; only for an accepted request. */
  position: number;
  locale?: string;
}): string | null {
  const { actor, verdict, locale } = args;
  if (verdict.accepted) {
    return viewerText(locale, "chat.request.queued", { actor, title: verdict.title, position: Math.max(1, args.position) });
  }
  switch (verdict.reason) {
    case "no-match":
      return viewerText(locale, "chat.request.noMatch", { actor });
    case "cooldown": {
      const seconds = Math.max(1, verdict.retryAfterSeconds);
      return seconds >= 60
        ? viewerText(locale, "chat.request.cooldownMinutes", { actor, count: Math.ceil(seconds / 60) })
        : viewerText(locale, "chat.request.cooldownSeconds", { actor, count: seconds });
    }
    case "queue-full":
      return viewerText(locale, "chat.request.queueFull", { actor });
    case "already-queued":
      return viewerText(locale, "chat.request.alreadyQueued", { actor, title: verdict.title });
    default:
      return null;
  }
}

/** Lines the bot may write in any 30 seconds; Twitch allows a non-moderator account 20 and holds back more. */
export const CHAT_SEND_BUDGET_LINES = 15;
export const CHAT_SEND_BUDGET_WINDOW_MS = 30_000;
/**
 * Slots a low-priority line (a request refusal) must leave free, so moderator check-ins, accepted
 * requests and the other answers still go out when refusals are many (R23).
 */
export const CHAT_SEND_BUDGET_RESERVED_LINES = 5;

/** "low": a line that must leave the reserve free (a request refusal); everything else is "normal". */
export type ChatLinePriority = "normal" | "low";

/**
 * The last guard before the socket: every line the bot writes (answers, game replies, check-ins)
 * takes one slot of a sliding 30-second window, and a line past the budget is dropped rather than
 * risking the account's chat access. The cooldowns above keep the bot far below it in normal use. A
 * line claimed with a `reserve` is dropped once fewer than that many slots would be left after it.
 */
export class ChatSendBudget {
  private readonly sentAtMs: number[] = [];

  constructor(
    private readonly lines = CHAT_SEND_BUDGET_LINES,
    private readonly windowMs = CHAT_SEND_BUDGET_WINDOW_MS
  ) {}

  claim(nowMs: number, reserve = 0): boolean {
    while (this.sentAtMs.length > 0 && nowMs - this.sentAtMs[0]! >= this.windowMs) {
      this.sentAtMs.shift();
    }
    if (this.sentAtMs.length >= this.lines - Math.max(0, reserve)) {
      return false;
    }
    this.sentAtMs.push(nowMs);
    return true;
  }
}

/** One IRC line: a title with a line break must not end the PRIVMSG and start a command of its own. */
export function sanitizeChatLine(message: string): string {
  // By code point, so a cut never splits an emoji's surrogate pair.
  return Array.from(message.replace(/[\r\n\u0000]+/g, " ").trim()).slice(0, 480).join("");
}
