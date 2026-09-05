// The one definition of "active chatter" in the worker.
//
// Two features count the room: the engagement game reports "N active chatters in the last W
// minutes" (the tracker's snapshot, printed on the overlays page), and the skip vote needs a share
// of the active chatters. They used to keep separate rosters over separate windows — the game over
// the operator's setting, the skip threshold over a hard-coded five minutes — so the page could say
// twelve people were in the room while a skip was decided as if one were. This roster is shared by
// both: one map of who spoke when, one window, read from the engagement settings and nowhere else.

import { getEngagementGameWindowMs, type EngagementSettings } from "@stream247/core";

/** The settings shape both readers already carry; only the window is read from it. */
export type ActiveChatterSettings = Partial<EngagementSettings> | null | undefined;

export class ActiveChatterRoster {
  private readonly seenAt = new Map<string, number>();
  private windowMs = getEngagementGameWindowMs(null);

  /**
   * Takes the window from the engagement settings. Called whenever a reader has fresh settings in
   * hand, so a changed window reaches the skip threshold on the next snapshot, not the next boot.
   */
  applySettings(settings: ActiveChatterSettings): void {
    this.windowMs = getEngagementGameWindowMs(settings);
  }

  getWindowMs(): number {
    return this.windowMs;
  }

  /** Twitch logins are case-insensitive, so "Viewer" and "viewer" are one chatter, not two. */
  recordSeen(actor: string, atMs: number): void {
    const key = actor.trim().toLowerCase();
    if (!key) {
      return;
    }

    this.seenAt.set(key, atMs);
  }

  /** How many distinct chatters spoke within the window ending now. Forgets the rest. */
  countActive(nowMs: number): number {
    const oldestAllowed = nowMs - this.windowMs;
    for (const [actor, lastSeenAt] of this.seenAt.entries()) {
      if (lastSeenAt < oldestAllowed) {
        this.seenAt.delete(actor);
      }
    }

    return this.seenAt.size;
  }
}
