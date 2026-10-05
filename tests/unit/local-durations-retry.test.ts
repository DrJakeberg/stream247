import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isUnansweredDurationProbe,
  LOCAL_DURATION_PROBE_RETRY_MS,
  resolveLocalFileDurations,
  type LocalDurationRetry
} from "../../apps/worker/src/local-durations";
import { ExecFileTextError, execFileText } from "../../apps/worker/src/process-utils";

// M105, review finding R14: a probe timeout or a spawn error was stored as a final "unreadable" result, so a
// good file kept duration 0 (the 30-minute estimate, no duration bound on air) until it was touched.

const timeout = () => new ExecFileTextError("Command timed out after 10000ms and terminated its process group.", "timeout");
const stat = async (filePath: string) => ({ size: filePath.length, mtimeMs: 1 });

describe("a local duration probe that got no answer", () => {
  it("stores nothing, waits half an hour, then probes the file again and stores its length", async () => {
    let clock = 0;
    const retries = new Map<string, LocalDurationRetry>();
    const probe = vi.fn(async () => {
      if (probe.mock.calls.length === 1) {
        throw timeout();
      }
      return 120;
    });
    const scan = (existingByPath: Map<string, { durationSeconds?: number; durationProbeKey?: string }>) =>
      resolveLocalFileDurations({ files: ["/media/a.mp4"], existingByPath, stat, probe, nowMs: () => clock, retries });

    const first = await scan(new Map());
    expect(first).toMatchObject({ probed: 1, failed: 0, unanswered: 1 });
    // Before M105: { durationSeconds: 0, durationProbeKey: "12:1" }, and never probed again.
    expect(first.entries.has("/media/a.mp4")).toBe(false);

    clock = LOCAL_DURATION_PROBE_RETRY_MS - 1;
    const waiting = await scan(first.entries);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(waiting).toMatchObject({ probed: 0, deferred: 0, unanswered: 0 });

    clock = LOCAL_DURATION_PROBE_RETRY_MS;
    const again = await scan(waiting.entries);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(again.entries.get("/media/a.mp4")).toEqual({ durationSeconds: 120, durationProbeKey: "12:1" });
    expect(retries.size).toBe(0);
  });

  it("does not hold up the files after it: a waiting file takes none of the scan budget", async () => {
    let clock = 0;
    const retries = new Map<string, LocalDurationRetry>();
    const probe = vi.fn(async (filePath: string) => {
      clock += 600;
      if (filePath === "/media/hung.mp4") {
        throw timeout();
      }
      return 60;
    });
    const files = ["/media/hung.mp4", "/media/b.mp4", "/media/c.mp4"];
    const first = await resolveLocalFileDurations({ files, existingByPath: new Map(), stat, probe, nowMs: () => clock, budgetMs: 1000, retries });
    expect(first).toMatchObject({ probed: 2, unanswered: 1, deferred: 1 });
    const second = await resolveLocalFileDurations({ files, existingByPath: first.entries, stat, probe, nowMs: () => clock, budgetMs: 1000, retries });
    expect(second).toMatchObject({ probed: 1, unanswered: 0, deferred: 0 });
    expect(second.entries.get("/media/c.mp4")).toEqual({ durationSeconds: 60, durationProbeKey: "12:1" });
  });

  it("probes a new version of the file at once, whatever it waited for", async () => {
    const retries = new Map<string, LocalDurationRetry>([["/media/a.mp4", { key: "old:1", notBeforeMs: Number.MAX_SAFE_INTEGER }]]);
    const probe = vi.fn(async () => 90);
    const result = await resolveLocalFileDurations({ files: ["/media/a.mp4"], existingByPath: new Map(), stat, probe, nowMs: () => 0, retries });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(result.entries.get("/media/a.mp4")).toEqual({ durationSeconds: 90, durationProbeKey: "12:1" });
  });

  it("keeps the M96 rule for an answer: ffprobe that read the file and refused it stores the key", async () => {
    const refused = new ExecFileTextError("Invalid data found when processing input", "exit", 1, null);
    const probe = vi.fn(async () => {
      throw refused;
    });
    const result = await resolveLocalFileDurations({ files: ["/media/broken.mp4"], existingByPath: new Map(), stat, probe });
    expect(result).toMatchObject({ probed: 1, failed: 1, unanswered: 0 });
    expect(result.entries.get("/media/broken.mp4")).toEqual({ durationSeconds: 0, durationProbeKey: "17:1" });
  });
});

describe("isUnansweredDurationProbe, on what execFileText really rejects with", () => {
  it("a timeout, a program that cannot be started and a signal are no answer; an exit code is one", async () => {
    const reasonOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);
    const timedOut = await reasonOf(execFileText(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 100 }));
    const notStarted = await reasonOf(execFileText("/nonexistent/stream247-ffprobe", []));
    const signalled = await reasonOf(execFileText(process.execPath, ["-e", "process.kill(process.pid, 'SIGKILL')"]));
    const refused = await reasonOf(execFileText(process.execPath, ["-e", "process.exit(1)"]));
    expect(timedOut).toBeInstanceOf(ExecFileTextError);
    expect((timedOut as Error).message).toMatch(/^Command timed out after 100ms/);
    expect(isUnansweredDurationProbe(timedOut)).toBe(true);
    expect(isUnansweredDurationProbe(notStarted)).toBe(true);
    expect(isUnansweredDurationProbe(signalled)).toBe(true);
    expect(refused).toMatchObject({ kind: "exit", exitCode: 1 });
    expect(isUnansweredDurationProbe(refused)).toBe(false);
    // Anything this cannot classify keeps the old rule (stored as read).
    expect(isUnansweredDurationProbe(new Error("ENOENT"))).toBe(false);
  });
});

describe("R14 wiring in the worker", () => {
  it("keeps the waiting files across scans in the worker's memory", () => {
    const flat = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8").replace(/\s+/g, " ");
    expect(flat).toContain("const localDurationProbeRetries = new Map<string, LocalDurationRetry>();");
    expect(flat).toContain("retries: localDurationProbeRetries });");
  });
});
