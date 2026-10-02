// The worker cycle runs its integration steps one by one, and one failing step no longer ends the
// cycle (M87, R3 H1).
//
// Until M87 `runWorkerCycle` awaited its steps in a row with nothing between them, so the first one
// that threw -- a refused Twitch refresh in R3's S2 run -- skipped every step after it, the
// heartbeat and the incident sweep included, on every cycle until the cause went away. The
// healthcheck then called a worker unhealthy that was doing everything except that one thing.
//
// Each step now fails on its own: it is reported, and the next step runs. The heartbeat and the
// incident sweep stay outside the steps, after them, so they run whenever the database does.

export type CycleStep = {
  /** Short, fixed name: it is the key of the step's incident and must stay bounded. */
  name: string;
  run: () => Promise<void>;
};

export type CycleStepHooks = {
  /**
   * Records a failed step. May throw to end the cycle after all: the caller does that when it cannot
   * record the failure either, because then the database is gone and the M86 outage path applies.
   */
  onFailure: (name: string, error: unknown) => Promise<void>;
  /** Called after a step completed. */
  onSuccess: (name: string) => Promise<void>;
};

/** Runs every step in order; returns the names of the steps that failed. */
export async function runIsolatedCycleSteps(steps: CycleStep[], hooks: CycleStepHooks): Promise<string[]> {
  const failed: string[] = [];

  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      failed.push(step.name);
      await hooks.onFailure(step.name, error);
      continue;
    }

    await hooks.onSuccess(step.name);
  }

  return failed;
}

/**
 * Which steps may still have an open `worker.step.failed.<step>` incident.
 *
 * A step's success closes its incident, but writing that on every step of every cycle would cost a
 * database write per step per 30 s for nothing. A step is therefore closed once per process (an
 * entry a previous process left open is closed on the first success after a restart) and again
 * only after it failed.
 */
export class CycleStepIncidentTracker {
  private readonly settled = new Set<string>();

  needsResolve(name: string): boolean {
    return !this.settled.has(name);
  }

  markResolved(name: string): void {
    this.settled.add(name);
  }

  markFailed(name: string): void {
    this.settled.delete(name);
  }
}
