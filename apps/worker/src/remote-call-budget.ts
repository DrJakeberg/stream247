// The time one worker cycle may spend waiting on source hosts (M112).
//
// M87 gave every yt-dlp call of the source syncs a timeout of its own (two minutes, clamped by the
// cycle-await ceiling). The syncs walk their sources one by one, though, so three sources on a host
// that stopped answering still held one cycle for six minutes and the stall guard (five minutes)
// exited the worker. The chapter backfill's probes add up the same way.
//
// A RemoteCallBudget is one deadline for all of them, the cycle-await ceiling after the cycle's start
// (half the stall budget by default). Three rules keep it from hurting a healthy source:
//
// - A source call starts only while at least `MIN_REMOTE_CALL_MS` (or its own timeout, if shorter) is
//   left, and its timeout is cut to what is left. A source the budget has no room for is not synced
//   this cycle: nothing about it is written, its stored items stay, and it goes first in its sync's
//   next run (`orderDeferredFirst`).
// - A call that runs out of a timeout the budget cut short proves nothing about its source: it is
//   deferred like a source without room, not reported as failed (`classifySourceSyncTimeout`).
// - A call that runs out of its whole own timeout is a host that does not answer: the failure is
//   recorded as before, and the source then waits `SOURCE_SYNC_TIMEOUT_BACKOFF_MS` before it is asked
//   again (`SourceSyncBackoff`). Without that pause a dead host at the head of the YouTube sync took the
//   budget on every cycle, and the Twitch sync and the chapter probes after it never got any.
//
// A chapter probe starts only when its whole timeout fits (`fitsWhole`): a cut-short probe that ran out
// would be stored as a failed probe and wait out the failure cooldown.

/** Below this a remote call is not worth starting. */
export const MIN_REMOTE_CALL_MS = 15_000;
/** How long a source whose call ran out of its whole timeout is left alone. */
export const SOURCE_SYNC_TIMEOUT_BACKOFF_MS = 10 * 60_000;

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

  /** `requestedMs` when the whole of it is left, otherwise null. */
  fitsWhole(requestedMs: number): number | null {
    return this.remainingMs() >= requestedMs ? requestedMs : null;
  }
}

/**
 * What a source call's error means for the sync: an ordinary failure, a cut-short timeout (defer the
 * source, report nothing), or a whole timeout (report the failure, then back the source off).
 */
export function classifySourceSyncTimeout(args: {
  timedOut: boolean;
  givenMs: number;
  requestedMs: number;
}): "failed" | "deferred" | "backoff" {
  if (!args.timedOut) {
    return "failed";
  }
  return args.givenMs < args.requestedMs ? "deferred" : "backoff";
}

/** Sources left alone after a whole timeout, until their pause ends. Process memory only. */
export class SourceSyncBackoff {
  private readonly untilMs = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  start(sourceId: string, pauseMs = SOURCE_SYNC_TIMEOUT_BACKOFF_MS): void {
    this.untilMs.set(sourceId, this.now() + pauseMs);
  }

  isActive(sourceId: string): boolean {
    const until = this.untilMs.get(sourceId);
    if (until === undefined) {
      return false;
    }
    if (this.now() >= until) {
      this.untilMs.delete(sourceId);
      return false;
    }
    return true;
  }
}

/**
 * The sources in their own order, the ones the last cycle deferred first (in their own order too).
 */
export function orderDeferredFirst<T extends { id: string }>(sources: T[], deferredIds: ReadonlySet<string>): T[] {
  return [...sources.filter((source) => deferredIds.has(source.id)), ...sources.filter((source) => !deferredIds.has(source.id))];
}
