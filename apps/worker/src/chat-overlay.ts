// Projection of persisted chat onto the on-air overlay.
//
// Chat arrives in the worker container and the overlay renders in the playout container, so the
// messages cross through Postgres exactly like the poll, the skip campaign, and the chat game do:
// the worker's bridge flushes its ring buffer into the chat_overlay_messages singleton row, and
// the playout render loop re-derives this view from the row on every render interval. Re-deriving
// rather than storing is what lets messages age off air between the worker's change-driven
// flushes — and what takes a dead worker's last flush off air instead of freezing it there.

import type { OverlayChatView } from "@stream247/core";

/**
 * The slice of the persisted row this projection needs, structural like VoteSessionOverlaySource
 * so the worker-side snapshot and the database row satisfy the same contract.
 */
export type ChatOverlayMessagesSource = {
  enabled: boolean;
  position: string;
  maxMessages: number;
  messages: { name: string; text: string; at: string }[];
};

// How long one message stays on air. This is the panel's own lifetime, not the definition of an
// "active chatter" — that is the engagement window in the worker's shared roster (see
// active-chatters.ts), which the operator can set anywhere from one to thirty minutes, and a panel
// that kept every line up for half an hour would be a wall, not chat. Five minutes is also the
// worker-death guard — the row has no deadline of its own the way the poll and skip rows do, so
// message age is the only signal playout has that what it is drawing stopped being live chat.
export const CHAT_OVERLAY_MESSAGE_TTL_MS = 5 * 60_000;

/**
 * What the chat panel should draw right now, or null — no panel — when chat is disabled, the row
 * is empty, or everything in it has aged out. A message whose timestamp does not parse counts as
 * aged out: a hand-edited or corrupted row must not pin text onto the broadcast forever.
 */
export function buildChatOverlayViewFromMessages(
  source: ChatOverlayMessagesSource,
  now: Date
): OverlayChatView | null {
  if (!source.enabled) {
    return null;
  }

  const oldestAllowed = now.getTime() - CHAT_OVERLAY_MESSAGE_TTL_MS;
  const fresh = source.messages.filter((message) => {
    const atMs = Date.parse(message.at);
    return Number.isFinite(atMs) && atMs >= oldestAllowed && atMs <= now.getTime() + 60_000;
  });

  if (fresh.length === 0) {
    return null;
  }

  const maxMessages = Math.min(12, Math.max(1, Math.round(source.maxMessages) || 1));
  return {
    position: source.position,
    maxMessages,
    messages: fresh.slice(-maxMessages).map((message) => ({ name: message.name, text: message.text }))
  };
}
