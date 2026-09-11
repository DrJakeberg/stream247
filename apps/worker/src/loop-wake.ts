// Edge-triggered wake latch for the playout reconciliation loop.
//
// The loop alternates between running a cycle and sleeping the loop delay (15s for playout).
// Until v1.5.33 the "run the next cycle immediately" signal was a bare callback handle that
// `waitForNextLoop` installed *while sleeping* and cleared on wake. `requestImmediatePlayoutCycle`
// read that handle and returned early when it was null — which is exactly the state during a
// running cycle. Every wake requested from inside the cycle was therefore dropped silently:
//
//   - the boundary fallback bridge (index.ts, "boundary-fallback-bridge"): after bridging to the
//     local fallback because the scheduled asset was not warm, the cycle asked for an immediate
//     follow-up to resolve and start the real asset. Dropped -> the fallback covered a full 15s
//     loop delay plus the next cycle's own work before the scheduled asset started. Measured on
//     the DUT as ~18s of fallback slate at two of three asset boundaries.
//   - the deferred-prefetch follow-up ("deferred-prefetch"), whose own comment promises the queue
//     "warms immediately instead of waiting out the loop delay". It never did.
//
// A latch fixes the lost wakeup: a wake requested with no waiter armed is remembered, and the loop
// consumes it right before it would sleep. The latch is edge-triggered — one request produces at
// most one skipped delay — and a burst limit keeps a pathological caller from turning the loop
// into a spin, so the loop-stall guard and the cycle budget are unaffected.

/** How a wake request was delivered. */
export type LoopWakeDelivery =
  // A sleeping waiter was resumed directly.
  | "woke-waiter"
  // No waiter was armed (a cycle is running); remembered for the upcoming sleep.
  | "latched"
  // A wake was already latched for this cycle; the extra request adds nothing.
  | "coalesced";

/**
 * Consecutive immediate cycles allowed before the loop is forced back onto its normal delay.
 *
 * Each legitimate caller latches only for a one-shot condition that the very next cycle resolves
 * (the bridge starts the real asset; the deferred prefetch warms the queue), so a burst this short
 * is never reached in practice. It exists so that a future caller which latches unconditionally
 * degrades into normal polling instead of starving the event loop.
 */
export const LOOP_WAKE_IMMEDIATE_BURST_LIMIT = 3;

export class LoopWakeLatch {
  private waiter: (() => void) | null = null;
  private pendingReason = "";
  private consecutiveImmediate = 0;

  /** Arm the sleeping loop's resume callback. Replaces any previously armed waiter. */
  arm(waiter: () => void): void {
    this.waiter = waiter;
  }

  /** Detach a waiter that finished on its own (timer fired), so it can never be resumed twice. */
  disarm(waiter: () => void): void {
    if (this.waiter === waiter) {
      this.waiter = null;
    }
  }

  /**
   * Ask for the next cycle to start immediately.
   *
   * Safe to call from anywhere — a running cycle, an ffmpeg exit handler, a timer. Never throws
   * and never blocks the caller.
   */
  request(reason: string): LoopWakeDelivery {
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter();
      return "woke-waiter";
    }
    if (this.pendingReason !== "") {
      return "coalesced";
    }
    this.pendingReason = reason;
    return "latched";
  }

  /**
   * Consume a wake latched during the cycle that just finished.
   *
   * Returns the reason when the loop should skip its delay and run the next cycle now, or "" when
   * it should sleep normally. Clears the latch either way, so a single request can shorten at most
   * one sleep. Returns "" once the burst limit is hit, and a normally paced cycle resets the burst.
   */
  takePending(): string {
    const reason = this.pendingReason;
    this.pendingReason = "";

    if (reason === "") {
      this.consecutiveImmediate = 0;
      return "";
    }

    if (this.consecutiveImmediate >= LOOP_WAKE_IMMEDIATE_BURST_LIMIT) {
      this.consecutiveImmediate = 0;
      return "";
    }

    this.consecutiveImmediate += 1;
    return reason;
  }
}
