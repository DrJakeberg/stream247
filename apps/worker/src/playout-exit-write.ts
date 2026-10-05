/**
 * The runtime write of a playout exit that the database did not take (review finding R3, 2026-10-05).
 *
 * The exit handler writes what the exit means -- nothing on air, an operator insert that ended cleared --
 * without waiting for it. When ffmpeg ends during a database outage that write is refused, and before
 * this it was dropped: since M86 the playout outlives the outage, so the first cycle after it read the old
 * row (the insert still `active`, its item still on air) with no process running and started the finished
 * Play now or Insert again from 0. Before M86 the process died with the worker and the row was just as
 * stale; the M74 guard at the top of the cycle only waits for the write, it cannot bring a lost one back.
 *
 * So the refused write is kept and applied again before the next state read, until the database takes it.
 * A process started since then has its own start write, which describes the air from then on: the kept
 * exit write is dropped at every spawn and never overwrites a newer process.
 *
 * No I/O here; the worker hands in the write.
 */

export interface FailedExitWrite<T> {
  /** The exit write was refused; keep it for the next cycle (the latest one wins). */
  fail(updater: T): void;
  /** A new process was spawned: its start write supersedes any exit write still kept. */
  supersede(): void;
  /**
   * Apply the kept write once more. Resolves true when one was applied and dropped, false when none was
   * kept; rejects (and keeps it) when the database refuses it again.
   */
  reapply(apply: (updater: T) => Promise<unknown>): Promise<boolean>;
  pending(): boolean;
}

export function createFailedExitWrite<T>(): FailedExitWrite<T> {
  let kept: T | null = null;
  return {
    fail(updater) {
      kept = updater;
    },
    supersede() {
      kept = null;
    },
    async reapply(apply) {
      const updater = kept;
      if (updater === null) {
        return false;
      }
      await apply(updater);
      // Dropped only if nothing replaced it meanwhile (a newer failed exit, a spawn).
      if (kept === updater) {
        kept = null;
      }
      return true;
    },
    pending() {
      return kept !== null;
    }
  };
}
