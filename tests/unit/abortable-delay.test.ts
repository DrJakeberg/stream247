import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { abortableDelay } from "../../apps/worker/src/abortable-delay.js";

// The scene writer calls this twice a second for as long as a playout process lives, and playout
// processes are expected to run for weeks. A listener left registered on each ordinary timeout is
// invisible in a unit test that only checks timing, so the listener count is asserted directly.

describe("abortableDelay", () => {
  it("resolves after the delay", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();

    await abortableDelay(20, controller.signal);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

  it("wakes early when aborted instead of running the timer down", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();

    const pending = abortableDelay(5_000, controller.signal);
    controller.abort();
    await pending;

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("returns immediately for a signal that is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(abortableDelay(5_000, controller.signal)).resolves.toBeUndefined();
  });

  it("leaves no listener behind when the timer fires", async () => {
    const controller = new AbortController();

    for (let index = 0; index < 50; index += 1) {
      await abortableDelay(0, controller.signal);
    }

    // Node exposes this on AbortSignal via the EventTarget shim; without deregistration this would
    // be 50 and climbing for the life of the process.
    expect(getListenerCount(controller.signal)).toBe(0);
  });

  it("leaves no listener behind when the signal aborts", async () => {
    const controller = new AbortController();

    const pending = [abortableDelay(5_000, controller.signal), abortableDelay(5_000, controller.signal)];
    controller.abort();
    await Promise.all(pending);

    expect(getListenerCount(controller.signal)).toBe(0);
  });

  it("resolves rather than rejects on abort, so callers need no try/catch", async () => {
    const controller = new AbortController();
    const pending = abortableDelay(5_000, controller.signal);
    controller.abort();

    await expect(pending).resolves.toBeUndefined();
  });
});

/** Reads the registered "abort" listener count off a signal. */
function getListenerCount(signal: AbortSignal): number {
  return getEventListeners(signal, "abort").length;
}
