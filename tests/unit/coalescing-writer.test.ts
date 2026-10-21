import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CoalescingWriter, KeyedCoalescingWriter } from "../../apps/worker/src/coalescing-writer.js";

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");

const settle = async () => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * A connection pool like pg's: `size` connections, and a caller that waits longer than
 * `acquireTimeoutMs` for one fails with pg's message. Each write holds a connection for `holdMs`.
 */
function fakePool(size: number, acquireTimeoutMs: number, holdMs: number) {
  let free = size;
  const waiters: Array<() => void> = [];
  let failures = 0;
  const release = () => {
    const next = waiters.shift();
    if (next) {
      next();
    } else {
      free += 1;
    }
  };
  const acquire = () =>
    new Promise<void>((resolve, reject) => {
      if (free > 0) {
        free -= 1;
        resolve();
        return;
      }
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        failures += 1;
        reject(new Error("timeout exceeded when trying to connect"));
      }, acquireTimeoutMs);
      waiters.push(waiter);
    });
  const write = async () => {
    await acquire();
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    release();
  };
  return { write, acquire, release, failures: () => failures };
}

describe("CoalescingWriter (M112)", () => {
  it("writes the first value at once and only the latest of what arrives meanwhile", async () => {
    const written: string[] = [];
    const gates: Array<() => void> = [];
    const writer = new CoalescingWriter<string>({
      write: (value) => {
        written.push(value);
        const gate = deferred();
        gates.push(gate.resolve);
        return gate.promise;
      },
      onError: () => {}
    });
    writer.submit("line 1");
    await settle();
    expect(written).toEqual(["line 1"]);
    for (let index = 2; index <= 800; index += 1) {
      writer.submit(`line ${index}`);
    }
    await settle();
    // Still one write in flight.
    expect(written).toEqual(["line 1"]);
    gates.shift()!();
    await settle();
    expect(written).toEqual(["line 1", "line 800"]);
    gates.shift()!();
    await settle();
    expect(written).toHaveLength(2);
    expect(writer.busy).toBe(false);
  });

  it("starts two writes no closer than minIntervalMs, and writes the last value of a burst", async () => {
    let nowMs = 0;
    const timers: Array<{ at: number; run: () => void }> = [];
    const written: Array<[number, string]> = [];
    const writer = new CoalescingWriter<string>({
      write: async (value) => {
        written.push([nowMs, value]);
      },
      onError: () => {},
      minIntervalMs: 10_000,
      now: () => nowMs,
      setTimer: (run, delayMs) => timers.push({ at: nowMs + delayMs, run })
    });
    writer.submit("a");
    await settle();
    nowMs = 1_000;
    writer.submit("b");
    writer.submit("c");
    await settle();
    expect(written).toEqual([[0, "a"]]);
    expect(timers.map((timer) => timer.at)).toEqual([10_000]);
    nowMs = 10_000;
    timers.shift()!.run();
    await settle();
    expect(written).toEqual([
      [0, "a"],
      [10_000, "c"]
    ]);
  });

  it("reports a failed write and still writes the next value", async () => {
    const errors: string[] = [];
    let calls = 0;
    const writer = new CoalescingWriter<string>({
      write: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("connection refused");
        }
      },
      onError: (error) => errors.push((error as Error).message)
    });
    writer.submit("a");
    await settle();
    writer.submit("b");
    await settle();
    expect(errors).toEqual(["connection refused"]);
    expect(calls).toBe(2);
  });

  it("survives an error reporter that throws: no rejection is left unhandled and the next value is written", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      let calls = 0;
      const writer = new CoalescingWriter<string>({
        write: async () => {
          calls += 1;
          throw new Error("pool exhausted");
        },
        onError: () => {
          throw new Error("logger broke");
        }
      });
      writer.submit("a");
      await settle();
      writer.submit("b");
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls).toBe(2);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("keeps one writer per key", async () => {
    const written: string[] = [];
    const gates: Array<() => void> = [];
    const keyed = new KeyedCoalescingWriter<string>(
      (key) =>
        new CoalescingWriter({
          write: (value) => {
            written.push(`${key}:${value}`);
            const gate = deferred();
            gates.push(gate.resolve);
            return gate.promise;
          },
          onError: () => {}
        })
    );
    keyed.submit("primary", "1");
    keyed.submit("backup", "1");
    keyed.submit("primary", "2");
    await settle();
    expect(written).toEqual(["primary:1", "backup:1"]);
  });

  // M98's measurement as a model: about 800 error lines a minute, each one a runtime write and an incident
  // write. pg's pool has 10 connections here; a read of the playout cycle must still get one.
  it("leaves a pool of 10 connections to the cycle under a burst of stderr lines that exhausts it with per-line writes", async () => {
    const burst = async (submitLine: () => void) => {
      // 400 lines, arriving in chunks as ffmpeg's stderr does: eight lines per millisecond tick.
      for (let tick = 0; tick < 50; tick += 1) {
        for (let line = 0; line < 8; line += 1) {
          submitLine();
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    };

    // Before M112: two unawaited writes per line. The pool runs out, as M98 measured ("timeout exceeded
    // when trying to connect", 578 times), and the cycle's own reads wait in the same queue.
    const perLine = fakePool(10, 50, 20);
    await burst(() => {
      void perLine.write().catch(() => {});
      void perLine.write().catch(() => {});
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(perLine.failures()).toBeGreaterThan(100);

    const coalesced = fakePool(10, 50, 20);
    let coalescedWrites = 0;
    const errors: unknown[] = [];
    const runtimeWriter = new CoalescingWriter<void>({
      write: () => {
        coalescedWrites += 1;
        return coalesced.write();
      },
      onError: (error) => errors.push(error),
      minIntervalMs: 20
    });
    const incidentWriter = new CoalescingWriter<string>({
      write: () => {
        coalescedWrites += 1;
        return coalesced.write();
      },
      onError: (error) => errors.push(error),
      minIntervalMs: 100
    });
    let coalescedCycleRead = "";
    const coalescedBurst = burst(() => {
      runtimeWriter.submit();
      incidentWriter.submit("[aac @ 0x1] error");
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await coalesced.acquire().then(
      () => {
        coalescedCycleRead = "ok";
        coalesced.release();
      },
      (error: Error) => {
        coalescedCycleRead = error.message;
      }
    );
    await coalescedBurst;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(coalesced.failures()).toBe(0);
    expect(errors).toEqual([]);
    expect(coalescedCycleRead).toBe("ok");
    // 800 submissions became a few dozen writes.
    expect(coalescedWrites).toBeLessThan(60);
  });

  it("is the only way the worker's stderr handlers reach the database", () => {
    const handlers = workerSource.split('child.stderr?.on("data", (chunk) => {').slice(1);
    // The playout's and the uplink's.
    expect(handlers).toHaveLength(2);
    for (const handler of handlers) {
      const body = handler.slice(0, handler.indexOf("\n  });\n"));
      for (const direct of [
        "updatePlayoutRuntime(",
        "upsertIncident(",
        "markDestinationFailure(",
        "updateProgramFeedRuntimeStatus("
      ]) {
        expect(body, direct).not.toContain(direct);
      }
      expect(body).toContain("stderrIncidentWriter.submit(");
      expect(body).toContain("stderrDestinationFailureWriter.submit(destinationId, line)");
    }
    // The uplink resolves the feed incident on every fresh cycle: its upsert is never held back 10 s.
    expect(workerSource.replace(/\s+/g, " ")).toContain(
      'minIntervalMs: fingerprint === "program-feed.input" ? 0 : 10_000'
    );
    expect(handlers[0]).toContain("playoutStderrRuntimeWriter.submit();");
    expect(handlers[1]).toContain("uplinkFeedStatusWriter.submit();");
  });
});
