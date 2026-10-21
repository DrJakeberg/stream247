import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FROZEN_AFTER_MS,
  FrozenChildWatch,
  SUPERVISOR_HEARTBEAT_MESSAGE,
  exitCodeForChild,
  frozenMarkerPath,
  runSupervisor,
  startSupervisorHeartbeat,
  takeFrozenMarker,
  writeFrozenMarker
} from "../../apps/worker/src/process-supervisor";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

// A stand-in for index.js: it sends heartbeats like startSupervisorHeartbeat, then does what its
// first argument says.
const CHILD = `
const behaviour = process.argv[2];
const beat = () => process.send && process.send(${JSON.stringify(SUPERVISOR_HEARTBEAT_MESSAGE)});
beat();
setInterval(beat, 20);
if (behaviour === "block") {
  setTimeout(() => { for (;;) {} }, 150);
} else if (behaviour === "exit3") {
  setTimeout(() => process.exit(3), 900);
} else if (behaviour === "silent") {
  process.send = undefined;
}
`;

function childScript(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "m114-child-"));
  const file = path.join(dir, "child.mjs");
  writeFileSync(file, CHILD);
  return file;
}

function supervise(behaviour: string, onChild?: (child: ReturnType<typeof runSupervisor>) => void) {
  const markerDir = mkdtempSync(path.join(tmpdir(), "m114-marker-"));
  const startedAt = Date.now();
  return new Promise<{ code: number; elapsedMs: number; markerDir: string }>((resolve) => {
    const child = runSupervisor({
      childScript: childScript(),
      args: [behaviour],
      mode: "playout",
      env: { ...process.env, STREAM247_SUPERVISOR_MARKER_DIR: markerDir },
      frozenAfterMs: 400,
      checkIntervalMs: 25,
      onExit: (code) => resolve({ code, elapsedMs: Date.now() - startedAt, markerDir })
    });
    onChild?.(child);
  });
}

describe("a frozen process restarts (M114, owner's choice A)", () => {
  it("uses the M103 five minutes", () => {
    expect(FROZEN_AFTER_MS).toBe(300_000);
  });

  it("counts silence from the last heartbeat, and from the start before the first one", () => {
    const watch = new FrozenChildWatch(0);
    expect(watch.check(FROZEN_AFTER_MS - 1).frozen).toBe(false);
    expect(watch.check(FROZEN_AFTER_MS).frozen).toBe(true);
    watch.beat(FROZEN_AFTER_MS);
    expect(watch.check(2 * FROZEN_AFTER_MS - 1)).toEqual({ frozen: false, silentForMs: FROZEN_AFTER_MS - 1 });
    // A heartbeat from the past (clock step) never moves the mark back.
    watch.beat(10);
    expect(watch.check(2 * FROZEN_AFTER_MS).frozen).toBe(true);
  });

  it("mirrors the child's own exit", () => {
    expect(exitCodeForChild(0, null)).toBe(0);
    expect(exitCodeForChild(3, null)).toBe(3);
    expect(exitCodeForChild(null, "SIGTERM")).toBe(143);
    expect(exitCodeForChild(null, "SIGSEGV")).toBe(1);
  });

  it("keeps the marker for the next process and hands it out once", () => {
    const markerPath = frozenMarkerPath("uplink", { STREAM247_SUPERVISOR_MARKER_DIR: mkdtempSync(path.join(tmpdir(), "m114-")) });
    expect(takeFrozenMarker(markerPath)).toBeNull();
    writeFrozenMarker(markerPath, { mode: "uplink", silentForMs: 301_000, killedAt: "2026-10-21T09:00:00.000Z" });
    expect(takeFrozenMarker(markerPath)).toEqual({ mode: "uplink", silentForMs: 301_000, killedAt: "2026-10-21T09:00:00.000Z" });
    expect(takeFrozenMarker(markerPath)).toBeNull();
    writeFileSync(markerPath, "not json");
    expect(takeFrozenMarker(markerPath)).toBeNull();
    expect(existsSync(markerPath)).toBe(false);
  });

  it("sends no heartbeat without a supervisor", () => {
    expect(startSupervisorHeartbeat({})).toBeNull();
  });

  it("kills a child whose event loop blocks, and leaves the marker", async () => {
    const result = await supervise("block");
    expect(result.code).toBe(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(400);
    expect(result.elapsedMs).toBeLessThan(5_000);
    expect(takeFrozenMarker(path.join(result.markerDir, "stream247-frozen-playout.json"))?.mode).toBe("playout");
  });

  it("kills a stopped child (SIGSTOP)", async () => {
    const result = await supervise("beat", (child) => {
      setTimeout(() => child.kill("SIGSTOP"), 150);
    });
    expect(result.code).toBe(1);
    expect(takeFrozenMarker(path.join(result.markerDir, "stream247-frozen-playout.json"))).not.toBeNull();
  });

  it("kills a child that never sends a heartbeat", async () => {
    const result = await supervise("silent");
    expect(result.code).toBe(1);
  });

  it("leaves a child alone while it sends heartbeats, and ends with its own exit code", async () => {
    const result = await supervise("exit3");
    expect(result.code).toBe(3);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(900);
    expect(takeFrozenMarker(path.join(result.markerDir, "stream247-frozen-playout.json"))).toBeNull();
  });
});

describe("M114 wiring", () => {
  const compose = read("docker-compose.yml");
  const worker = read("apps/worker/src/index.ts");

  it("runs worker, playout and uplink under the supervisor; the healthchecks still call index.js", () => {
    expect(read("docker/worker.Dockerfile")).toContain('CMD ["node", "apps/worker/dist/supervisor.js", "worker"]');
    expect(compose).toContain('command: ["node", "apps/worker/dist/supervisor.js", "playout"]');
    expect(compose).toContain('command: ["node", "apps/worker/dist/supervisor.js", "uplink"]');
    expect(compose).not.toMatch(/command: \["node", "apps\/worker\/dist\/index\.js"/);
    expect(compose.match(/"apps\/worker\/dist\/index\.js", "healthcheck"/g)).toHaveLength(3);
    expect(read("docker-compose.dev.yml")).toContain('"apps/worker/dist/supervisor.js", "playout"');
  });

  it("starts the heartbeat and reports a frozen restart before the loop runs", () => {
    const dispatch = worker.slice(worker.lastIndexOf("startSupervisorHeartbeat();"));
    expect(dispatch.indexOf("reportFrozenRestart(mode)")).toBeGreaterThan(0);
    expect(dispatch.indexOf("reportFrozenRestart(mode)")).toBeLessThan(dispatch.indexOf("runLoop(mode)"));
    expect(worker).toContain("fingerprint: `${mode}.health.frozen-restart`");
  });
});
