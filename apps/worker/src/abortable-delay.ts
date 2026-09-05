/**
 * Sleeps for `ms`, waking early when `signal` aborts.
 *
 * The cleanup is the point. Playout loops call this several times a second for the lifetime of a
 * process that is expected to run for weeks, so a listener left registered on each ordinary timeout
 * accumulates on the signal by the thousand and eventually trips Node's max-listener warning.
 * Both exits — timer fired, signal aborted — deregister.
 *
 * Resolves rather than rejects on abort: callers re-check their own loop condition, and a rejection
 * would force every call site into a try/catch that does nothing but swallow it.
 */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout;
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}
