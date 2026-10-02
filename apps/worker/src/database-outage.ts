// How long a worker process keeps running while it cannot reach the database (M86).
//
// Until M86 a failed cycle wrote its incident and alert with no catch, so the first cycle that
// landed in a Postgres stop or restart rejected runLoop and the process exited -- in the playout
// container that took ffmpeg and the broadcast with it (R3's S1 run: all three processes gone
// within one cycle of `docker stop postgres`). The process now rides the outage out: ffmpeg keeps
// playing the input it already has, and the pool reconnects once Postgres is back.
//
// The bound is the owner's (proposal 2026-10, Q2): after five minutes of consecutive cycles that
// could not reach the database, the process gives up and exits, so the restart policy brings up a
// fresh one. A failed cycle whose incident write succeeds proves the database is reachable; it
// ends the streak and never counts towards the exit, as before M86.

export const DATABASE_OUTAGE_EXIT_AFTER_MS = 5 * 60_000;

export type DatabaseOutageVerdict = {
  /** Time since the first cycle of the current streak that could not reach the database. */
  outageMs: number;
  /** True once the streak has lasted the full bound: the process should exit. */
  exit: boolean;
};

export class DatabaseOutageBudget {
  private firstUnreachableAtMs: number | null = null;

  constructor(private readonly exitAfterMs: number = DATABASE_OUTAGE_EXIT_AFTER_MS) {}

  /** A cycle completed, or its failure could be recorded: the database answered. */
  recordReachable(): void {
    this.firstUnreachableAtMs = null;
  }

  /** A cycle failed and its incident could not be written either. */
  recordUnreachable(nowMs: number): DatabaseOutageVerdict {
    if (this.firstUnreachableAtMs === null || nowMs < this.firstUnreachableAtMs) {
      this.firstUnreachableAtMs = nowMs;
    }

    const outageMs = nowMs - this.firstUnreachableAtMs;
    return { outageMs, exit: outageMs >= this.exitAfterMs };
  }
}
