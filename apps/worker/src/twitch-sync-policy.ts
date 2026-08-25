export function isTwitchScheduleSyncEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env.TWITCH_SCHEDULE_SYNC_ENABLED || "1") !== "0";
}

// One helix/channels PATCH per half minute at most. Chapter boundaries made metadata changes far
// more frequent than the old one-title-per-asset world — a replayed VOD can cross a boundary,
// restart, and cross it again inside a minute — and Twitch rate-limits repeated channel edits.
export const TWITCH_CHANNEL_METADATA_WRITE_MIN_INTERVAL_MS = 30_000;

export type TwitchChannelMetadataWriteDecision =
  | { write: true }
  | { write: false; reason: "waiting-for-broadcaster" | "unchanged" | "throttled" };

/**
 * Whether this cycle may PATCH the channel's title and category.
 *
 * The single decision point in front of the Helix channel write, so the M51 gate, the
 * skip-if-unchanged rule and the write throttle cannot drift apart across call sites. Waiting
 * mode never writes — that is the broadcast-channel split's core guarantee. A due-but-throttled
 * write is deferred, not dropped: the caller must leave the last-synced fields untouched so the
 * next cycle still sees the difference and retries once the interval has passed.
 */
export function decideTwitchChannelMetadataWrite(args: {
  gateMode: "identity" | "waiting-for-broadcaster" | "broadcaster";
  desiredTitle: string;
  desiredCategoryId: string;
  lastSyncedTitle: string;
  lastSyncedCategoryId: string;
  lastWriteAtMs: number;
  nowMs: number;
}): TwitchChannelMetadataWriteDecision {
  if (args.gateMode === "waiting-for-broadcaster") {
    return { write: false, reason: "waiting-for-broadcaster" };
  }

  if (args.lastSyncedTitle === args.desiredTitle && args.lastSyncedCategoryId === args.desiredCategoryId) {
    return { write: false, reason: "unchanged" };
  }

  if (args.lastWriteAtMs > 0 && args.nowMs - args.lastWriteAtMs < TWITCH_CHANNEL_METADATA_WRITE_MIN_INTERVAL_MS) {
    return { write: false, reason: "throttled" };
  }

  return { write: true };
}
