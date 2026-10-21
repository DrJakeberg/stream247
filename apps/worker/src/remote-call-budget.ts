// The time one worker cycle may spend waiting on source hosts (M112).
//
// M87 gave every yt-dlp call of the source syncs a timeout of its own (two minutes, clamped by the
// cycle-await ceiling). The syncs walk their sources one by one, though, so three sources on a host
// that stopped answering still held one cycle for six minutes and the stall guard (five minutes)
// exited the worker. The chapter backfill's probes add up the same way.
//
// The rules, each kept simple because every cleverer one cost a healthy source somewhere (three review
// rounds, see the M112 notes in PLANS.md):
//
// - A call always gets its whole own timeout: no timeout is ever cut short, so a slow but healthy
//   listing is never reported as failed because of this budget.
// - A call starts only when its whole timeout still ends before the cycle's deadline
//   (`RemoteCallBudget.fitsWhole`), `CYCLE_REMOTE_RESERVE_FRACTION` of the stall guard before it, so the
//   steps after the calls (the Twitch requests, 10 s each) still fit. A source without room is not synced
//   this cycle: nothing about it is written, its stored items stay, and it goes first in its sync's next
//   run (`orderDeferredFirst`).
// - The YouTube sync runs before the Twitch sync. When the Twitch sync had to defer a source, the YouTube
//   sync leaves one call's timeout for it (`reserveMs`), so a heavy YouTube load cannot keep Twitch
//   waiting for good.
// - A call that runs out of its timeout is a host that does not answer: reported as failed, as before
//   M112, and the source is then left alone for `SOURCE_SYNC_TIMEOUT_BACKOFF_MS` (`SourceSyncPauses`),
//   so a dead host costs one call per pause instead of one per cycle. The pause is keyed by the source
//   and its URL: an operator who fixes the URL gets the next run at once.

/** The share of the stall guard kept for everything after the remote calls. */
export const CYCLE_REMOTE_RESERVE_FRACTION = 0.2;
/** How long a source whose call ran out of its timeout is left alone. */
export const SOURCE_SYNC_TIMEOUT_BACKOFF_MS = 10 * 60_000;

export class RemoteCallBudget {
  readonly deadlineMs: number;

  private constructor(
    deadlineMs: number,
    private readonly now: () => number
  ) {
    this.deadlineMs = deadlineMs;
  }

  /** The cycle's budget: no remote call may run past `1 - CYCLE_REMOTE_RESERVE_FRACTION` of the stall guard. */
  static forCycle(stallTimeoutMs: number, now: () => number = Date.now): RemoteCallBudget {
    return new RemoteCallBudget(now() + Math.floor(Math.max(0, stallTimeoutMs) * (1 - CYCLE_REMOTE_RESERVE_FRACTION)), now);
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineMs - this.now());
  }

  /**
   * `timeoutMs` when a call with that whole timeout, plus `reserveMs` kept for a later step, still ends
   * before the deadline; otherwise null and the call does not start.
   */
  fitsWhole(timeoutMs: number, reserveMs = 0): number | null {
    return this.remainingMs() - Math.max(0, reserveMs) >= timeoutMs ? timeoutMs : null;
  }
}

/** Sources left alone after running out of their timeout. Process memory only. */
export class SourceSyncPauses {
  private readonly untilMs = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  start(key: string): void {
    this.untilMs.set(key, this.now() + SOURCE_SYNC_TIMEOUT_BACKOFF_MS);
  }

  isPaused(key: string): boolean {
    const until = this.untilMs.get(key);
    if (until === undefined) {
      return false;
    }
    if (this.now() >= until) {
      this.untilMs.delete(key);
      return false;
    }
    return true;
  }
}

/** The key a source's pause is kept under: its id and its URL. */
export function sourceSyncPauseKey(source: { id: string; externalUrl?: string }): string {
  return `${source.id}\n${source.externalUrl?.trim() ?? ""}`;
}

/**
 * The sources the last cycles deferred first, longest waiting first (the order of `deferredIds`, a Set
 * kept in the order the sources were deferred), then the rest in their own order. A source synced this
 * cycle and deferred again goes behind the ones still waiting, so an overloaded sync takes turns.
 */
export function orderDeferredFirst<T extends { id: string }>(sources: T[], deferredIds: ReadonlySet<string>): T[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const deferred = [...deferredIds].flatMap((id) => {
    const source = byId.get(id);
    return source ? [source] : [];
  });
  return [...deferred, ...sources.filter((source) => !deferredIds.has(source.id))];
}
