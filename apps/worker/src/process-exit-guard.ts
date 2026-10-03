/**
 * Whose exit is this? (M95, W7; R3 finding W7, audit U33.)
 *
 * `stopPlayoutProcess` gives up on an ffmpeg that has not exited 20 s after SIGTERM (a hung mount,
 * uninterruptible I/O), clears the module state and lets the cycle start a replacement. When the
 * abandoned process finally exits, its exit handler used to run in full: it cleared the
 * replacement's process handle, stopped its scene renderer, read and cleared its planned-stop
 * reason, overwrote the M94 retry marker and wrote "idle" or "failed" over the replacement's
 * runtime row. The replacement kept playing with no watchdog and no overlay writer, and the next
 * cycle spawned a third process onto the same playlist.
 *
 * An exit is stale when a different process is current, or when nothing is current because the
 * stop deadline abandoned this one. A process that is still the current one is never stale, and
 * neither is one that left the slot without being abandoned: then its handler is the only thing
 * that records the exit.
 */
export function isStaleProcessExit<T>(args: { current: T | null; exiting: T; abandoned: boolean }): boolean {
  if (args.current === args.exiting) {
    return false;
  }
  return args.current !== null || args.abandoned;
}
