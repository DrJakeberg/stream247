// The time one worker cycle may spend waiting on source hosts (M112).
//
// M87 gave every yt-dlp call of the source syncs a timeout of its own (two minutes, clamped by the
// cycle-await ceiling). The syncs walk their sources one by one, though, so three sources on a host
// that stopped answering still held one cycle for six minutes and the stall guard (five minutes)
// exited the worker. The chapter backfill's probes add up the same way.
//
// A RemoteCallBudget is one deadline for all of them, the cycle-await ceiling after the cycle's start
// (half the stall budget by default). A call starts only while at least `MIN_REMOTE_CALL_MS` (or its
// own timeout, if that is shorter) is left, and its timeout is cut to what is left. A source the
// budget has no room for is not synced this cycle: nothing about it is written, its stored items
// stay, and it goes first in the next cycle (`orderDeferredFirst`), so a dead host at the head of the
// list cannot keep a healthy source behind it waiting forever.

/** Below this a remote call is not worth starting: a listing that is cut off reads as a failed source. */
export const MIN_REMOTE_CALL_MS = 15_000;

export class RemoteCallBudget {
  readonly deadlineMs: number;

  constructor(
    totalMs: number,
    private readonly now: () => number = Date.now
  ) {
    this.deadlineMs = now() + Math.max(0, totalMs);
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineMs - this.now());
  }

  /**
   * The timeout a call that asks for `requestedMs` gets now, or null when the budget has no room left
   * for it. Never longer than requested.
   */
  timeoutFor(requestedMs: number): number | null {
    const remaining = this.remainingMs();
    if (remaining < Math.min(requestedMs, MIN_REMOTE_CALL_MS)) {
      return null;
    }
    return Math.min(requestedMs, remaining);
  }
}

/**
 * The sources in their own order, the ones the last cycle deferred first (in their own order too).
 */
export function orderDeferredFirst<T extends { id: string }>(sources: T[], deferredIds: ReadonlySet<string>): T[] {
  return [...sources.filter((source) => deferredIds.has(source.id)), ...sources.filter((source) => !deferredIds.has(source.id))];
}
