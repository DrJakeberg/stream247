// The time one worker cycle may spend waiting on source hosts (M112).
//
// M87 gave every yt-dlp call of the source syncs a timeout of its own (two minutes, clamped by the
// cycle-await ceiling). The syncs walk their sources one by one, though, so three sources on a host
// that stopped answering still held one cycle for six minutes and the stall guard (five minutes)
// exited the worker. The chapter backfill's probes add up the same way.
//
// Two deadlines bound them now:
//
// - Each sync step (the YouTube sync, the Twitch sync) gets one call's timeout from its own start
//   (`RemoteCallBudget.forStep`): its first call always gets its whole timeout, whatever the steps
//   before it took, and one step can never take the time of the next.
// - The whole cycle stops starting calls `CYCLE_REMOTE_RESERVE_MS` before the stall guard
//   (`RemoteCallBudget.forCycle`), so the steps together, the chapter probes included, cannot reach it.
//
// A call starts only while at least `MIN_REMOTE_CALL_MS` (or its own timeout, if shorter) is left,
// and gets no more than is left. A source without room is not synced this cycle: nothing about it is
// written, its stored items stay, and it goes first in its sync's next run (`orderDeferredFirst`).
//
// A call that runs out of its time is judged by `SourceSyncTimeouts.settle`:
// - out of its whole timeout: a host that does not answer. Reported as failed, as before M112, and the
//   source is left alone for `SOURCE_SYNC_TIMEOUT_BACKOFF_MS`, so a dead host costs one call per pause
//   instead of one per cycle;
// - out of a timeout a deadline had cut short: proves nothing, so the source is deferred, not reported,
//   and goes first next run. Cut short a second time in a row it is reported and paused like a whole
//   timeout: a source that never gets an answer in the time a cycle has must still show up as failed.
//
// A source paused after running out of time is walked last once its pause ends, until it answers
// (`orderSourcesForSync`): a dead host back from its pause never again holds up the healthy sources.
//
// The pause is keyed by the source and its URL: an operator who fixes the URL gets the next run at once.

/** Below this a remote call is not worth starting. */
export const MIN_REMOTE_CALL_MS = 15_000;
/** How long a source whose call ran out of its time is left alone. */
export const SOURCE_SYNC_TIMEOUT_BACKOFF_MS = 10 * 60_000;
/** What the cycle keeps for everything after its remote calls, below the stall guard. */
export const CYCLE_REMOTE_RESERVE_MS = 30_000;

export class RemoteCallBudget {
  readonly deadlineMs: number;

  private constructor(
    deadlineMs: number,
    private readonly now: () => number
  ) {
    this.deadlineMs = deadlineMs;
  }

  /** The cycle's budget: calls stop `CYCLE_REMOTE_RESERVE_MS` before the stall guard would fire. */
  static forCycle(stallTimeoutMs: number, now: () => number = Date.now): RemoteCallBudget {
    return new RemoteCallBudget(now() + Math.max(0, stallTimeoutMs - CYCLE_REMOTE_RESERVE_MS), now);
  }

  /** One step's budget: `stepMs` from now, never past the cycle's deadline. */
  forStep(stepMs: number): RemoteCallBudget {
    return new RemoteCallBudget(Math.min(this.now() + Math.max(0, stepMs), this.deadlineMs), this.now);
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

export type SourceSyncTimeoutVerdict =
  // Not a timeout: an ordinary failure, reported as before.
  | "failed"
  // Out of a timeout a deadline cut short, the first time in a row: not synced, not reported.
  | "deferred"
  // Out of its whole timeout, or cut short twice in a row: reported as failed, then paused.
  | "failed-backoff";

/** Process memory of the source syncs' timeouts: who is paused, who was cut short last time. */
export class SourceSyncTimeouts {
  private readonly pausedUntilMs = new Map<string, number>();
  private readonly cutShort = new Set<string>();
  // Paused after running out of time, and has not answered since: walked last.
  private readonly suspect = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Whether the source (with this URL) is paused after a timeout. */
  isPaused(key: string): boolean {
    const until = this.pausedUntilMs.get(key);
    if (until === undefined) {
      return false;
    }
    if (this.now() >= until) {
      this.pausedUntilMs.delete(key);
      return false;
    }
    return true;
  }

  /** Whether the source was paused after running out of time and has not answered since. */
  isSuspect(key: string): boolean {
    return this.suspect.has(key);
  }

  /** The source's call came back with an answer (a listing or an error that is not a timeout). */
  answered(key: string): void {
    this.cutShort.delete(key);
    this.suspect.delete(key);
  }

  /** Judges a failed call; starts the pause when the verdict says so. */
  settle(key: string, args: { timedOut: boolean; givenMs: number; requestedMs: number }): SourceSyncTimeoutVerdict {
    if (!args.timedOut) {
      this.answered(key);
      return "failed";
    }
    if (args.givenMs < args.requestedMs && !this.cutShort.has(key)) {
      this.cutShort.add(key);
      return "deferred";
    }
    this.cutShort.delete(key);
    this.suspect.add(key);
    this.pausedUntilMs.set(key, this.now() + SOURCE_SYNC_TIMEOUT_BACKOFF_MS);
    return "failed-backoff";
  }
}

/** The key a source's timeouts are kept under: its id and its URL. */
export function sourceSyncTimeoutKey(source: { id: string; externalUrl?: string }): string {
  return `${source.id}\n${source.externalUrl?.trim() ?? ""}`;
}

/**
 * The order a sync walks its sources in: the ones the last cycle deferred first, then the rest, and a
 * source paused after running out of time (a host back from its pause) last, so it never holds a
 * healthy source up again. Each group keeps the sources' own order.
 */
export function orderSourcesForSync<T extends { id: string; externalUrl?: string }>(
  sources: T[],
  deferredIds: ReadonlySet<string>,
  timeouts: SourceSyncTimeouts
): T[] {
  const ordered = orderDeferredFirst(sources, deferredIds);
  return [
    ...ordered.filter((source) => !timeouts.isSuspect(sourceSyncTimeoutKey(source))),
    ...ordered.filter((source) => timeouts.isSuspect(sourceSyncTimeoutKey(source)))
  ];
}

/**
 * The sources in their own order, the ones the last cycle deferred first (in their own order too).
 */
export function orderDeferredFirst<T extends { id: string }>(sources: T[], deferredIds: ReadonlySet<string>): T[] {
  return [...sources.filter((source) => deferredIds.has(source.id)), ...sources.filter((source) => !deferredIds.has(source.id))];
}
