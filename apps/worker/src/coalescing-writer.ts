// Database writes fired from ffmpeg's stderr, at most one at a time (M112).
//
// The playout's and the uplink's stderr handlers used to fire one unawaited write per chunk: a runtime
// update (a whole state read under the state write lock) for every chunk, an incident upsert for every
// line with "error" in it, a destination update (another whole state read) for every output error. A
// noisy input -- an mp4 read without Range support printed about 800 AAC error lines a minute in M98's
// test -- queued hundreds of writes at once, exhausted the connection pool ("timeout exceeded when
// trying to connect", 578 times) and with it the playout cycle's own reads, and the loop crashed
// (worker.loop.crashed).
//
// A CoalescingWriter keeps at most one write in flight. What arrives meanwhile is not queued: only the
// latest value is kept and written once the running write has ended, and not sooner than `minIntervalMs`
// after that write started. The first value of a burst is written at once, so a new incident still opens
// on its first line; the last value of a burst is always written, so the row ends up naming the last line.
// The log line per chunk stays as it is: it costs no connection.

export type CoalescingWriterOptions<T> = {
  write: (value: T) => Promise<unknown>;
  /** Called with a failed write's error; the next value is still written. Never awaited. */
  onError: (error: unknown) => void;
  /** Least time between the starts of two writes. 0: the next write starts as soon as the last ended. */
  minIntervalMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
};

export class CoalescingWriter<T> {
  private inFlight = false;
  private timerArmed = false;
  private pending: { value: T } | null = null;
  private lastStartedAtMs = Number.NEGATIVE_INFINITY;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;

  constructor(private readonly options: CoalescingWriterOptions<T>) {
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        // A pending stderr write must never keep a stopping process alive.
        timer.unref?.();
        return timer;
      });
  }

  /** Writes `value` now, or keeps it as the one value written after the running write. */
  submit(value: T): void {
    this.pending = { value };
    this.drain();
  }

  /** True while a write runs or a value waits for one. */
  get busy(): boolean {
    return this.inFlight || this.pending !== null;
  }

  private drain(): void {
    if (this.inFlight || this.timerArmed || this.pending === null) {
      return;
    }
    const waitMs = this.lastStartedAtMs + this.minIntervalMs - this.now();
    if (waitMs > 0) {
      this.timerArmed = true;
      this.setTimer(() => {
        this.timerArmed = false;
        this.drain();
      }, waitMs);
      return;
    }
    const { value } = this.pending;
    this.pending = null;
    this.inFlight = true;
    this.lastStartedAtMs = this.now();
    void Promise.resolve()
      .then(() => this.options.write(value))
      .catch((error: unknown) => {
        try {
          this.options.onError(error);
        } catch {
          // A failing reporter must not leave a rejection with nobody listening.
        }
      })
      .finally(() => {
        this.inFlight = false;
        this.drain();
      });
  }
}

/** One CoalescingWriter per key: one destination's failure never waits behind another's. */
export class KeyedCoalescingWriter<T> {
  private readonly writers = new Map<string, CoalescingWriter<T>>();

  constructor(private readonly create: (key: string) => CoalescingWriter<T>) {}

  submit(key: string, value: T): void {
    let writer = this.writers.get(key);
    if (!writer) {
      writer = this.create(key);
      this.writers.set(key, writer);
    }
    writer.submit(value);
  }
}
