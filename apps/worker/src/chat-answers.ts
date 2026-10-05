// What the chat bot says back, decided per chat effect (M78's skip-paused line, M104's answers).
//
// Out of index.ts so the rules can be driven in tests (review finding R27): the IRC handler there and
// the worker cycle's request drain call these with the real chat runtime's effects and the bridge's say,
// and tests/unit/chat-answers.test.ts drives the same functions with a runtime and a fake socket instead of
// grepping the worker's source.

import {
  formatChatCommandsReply,
  formatChatNextReply,
  formatChatNowReply,
  formatChatRequestReply,
  formatChatSkipPausedReply,
  type ChatInteractionConfig,
  type ChatLinePriority,
  type ChatProgrammeInfo,
  type RequestVerdict,
  type ViewerLocale
} from "@stream247/core";
import type { ChatControlEffect } from "./chat-control.js";

export type ChatSay = (line: string, priority?: ChatLinePriority) => void;

/**
 * The bot's answer to one message, right away: why a skip vote is paused (at most once a minute), and
 * !commands, !now and !next when the runtime granted the cooldowns (`effect.answer`). !now and !next wait
 * for `programme`, which reads what plays when asked (R22); everything else is said before the first await,
 * in the socket handler's turn. One argument object with the language as `locale`, as the M80 guard reads it
 * (tests/unit/viewer-language-worker-wiring.test.ts).
 */
export async function answerChatEffect(args: {
  effect: ChatControlEffect;
  say: ChatSay;
  config: ChatInteractionConfig;
  locale: ViewerLocale;
  /** What !now and !next answer from. Never throws: it falls back to what the last cycle read. */
  programme: () => Promise<ChatProgrammeInfo>;
}): Promise<void> {
  const { effect } = args;
  if (effect.kind === "skip-paused") {
    // The room is told once why its !skip did nothing (M78); a silent refusal makes a room type it again.
    if (effect.announce) {
      args.say(formatChatSkipPausedReply(effect.hold, args.locale));
    }
    return;
  }
  if (effect.kind !== "info" || !effect.answer) {
    return;
  }
  if (effect.info === "commands") {
    // !game always answers while chat is connected (handleChatGameCommand), so it is listed with the rest.
    args.say(formatChatCommandsReply({ actor: effect.actor, config: args.config, gameCommand: true, locale: args.locale }));
    return;
  }
  const programme = await args.programme();
  if (effect.info === "now") {
    args.say(formatChatNowReply(effect.actor, programme, args.locale));
  } else {
    args.say(formatChatNextReply(effect.actor, programme, args.locale));
  }
}

/**
 * The one answer to a `!request` (M104), behind the request-reply switch. An accepted request is always
 * confirmed. A refusal is said only when `claimRefusal` grants it (the viewer's minute and the room's five
 * in 30 seconds, R23), and as a low-priority line that leaves the send budget's reserve to the rest.
 */
export function replyToChatRequest(args: {
  actor: string;
  verdict: RequestVerdict;
  /** The accepted request's place in the queue; 0 for a refusal. */
  position: number;
  config: ChatInteractionConfig;
  locale: ViewerLocale;
  claimRefusal: (actor: string) => boolean;
  say: ChatSay;
}): void {
  if (!args.config.requestRepliesEnabled) {
    return;
  }
  const line = formatChatRequestReply({ actor: args.actor, verdict: args.verdict, position: args.position, locale: args.locale });
  if (!line) {
    return;
  }
  if (args.verdict.accepted) {
    args.say(line);
    return;
  }
  // Formatted before the claim, so a verdict with nothing to say does not use up the viewer's minute.
  if (args.claimRefusal(args.actor)) {
    args.say(line, "low");
  }
}
