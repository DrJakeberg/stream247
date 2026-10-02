// M86: a database blip does not take the channel off air.
//
// Runs against a real postgres:16-alpine container on a fixed host port, so the container can be
// stopped and started again under the same DATABASE_URL -- the same thing `docker compose stop
// postgres` does to a running stack. The last test is R3's S1 run (planning/research/robustness.md,
// "S1 evidence") as a test: the built worker binary in all three modes, Postgres stopped for 45 s.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureDatabase, getDatabaseHealth, readAppState, resetDatabaseConnectionsForTests } from "@stream247/db";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const workerEntry = path.join(repoRoot, "apps/worker/dist/index.js");
const testAppSecret = "stream247-m86-outage-test-secret-0123456789";

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args);
  return stdout.trim();
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.sequential("database outage (M86)", () => {
  const containerName = `stream247-db-outage-${randomUUID().slice(0, 8)}`;
  let port = 0;
  let workDir = "";
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAppSecret = process.env.APP_SECRET;
  const children: ChildProcess[] = [];

  async function waitForPostgres(): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        // Over TCP, as the app connects: the container's own socket answers before the port does.
        await runDocker(["exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", "stream247", "-d", "stream247"]);
        if (await canConnect(port)) {
          return;
        }
      } catch {
        // still starting
      }
      await sleep(500);
    }
    throw new Error("PostgreSQL did not become ready.");
  }

  async function psql(sql: string): Promise<string> {
    return runDocker(["exec", containerName, "psql", "-U", "stream247", "-d", "stream247", "-Atc", sql]);
  }

  beforeAll(async () => {
    port = await findFreePort();
    // No --rm: the container is stopped and started again by the tests.
    await runDocker([
      "run",
      "-d",
      "--name",
      containerName,
      "-e",
      "POSTGRES_DB=stream247",
      "-e",
      "POSTGRES_USER=stream247",
      "-e",
      "POSTGRES_PASSWORD=stream247",
      "-p",
      `127.0.0.1:${port}:5432`,
      "postgres:16-alpine"
    ]);
    await waitForPostgres();
    process.env.DATABASE_URL = `postgresql://stream247:stream247@127.0.0.1:${port}/stream247`;
    process.env.APP_SECRET = testAppSecret;
    await resetDatabaseConnectionsForTests();
    workDir = mkdtempSync(path.join(os.tmpdir(), "stream247-m86-"));
  }, 60_000);

  afterAll(async () => {
    for (const child of children) {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
    await resetDatabaseConnectionsForTests();
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.APP_SECRET = originalAppSecret;
    await runDocker(["rm", "-f", containerName]).catch(() => {});
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("ensureDatabase fails while Postgres is down and succeeds once it is back, without a reset", async () => {
    await runDocker(["stop", "-t", "5", containerName]);

    const down = await ensureDatabase().then(
      () => null,
      (error: unknown) => error
    );
    expect(down).toBeInstanceOf(Error);
    expect(await getDatabaseHealth()).toBe("error");

    await runDocker(["start", containerName]);
    await waitForPostgres();

    // Before M86 the rejected bootstrap stayed cached and these failed until
    // resetDatabaseConnectionsForTests ran (R3 S3); nothing resets anything here.
    await expect(ensureDatabase()).resolves.toBeUndefined();
    expect(await getDatabaseHealth()).toBe("ok");
    const state = await readAppState();
    expect(state.playout).toBeDefined();
  }, 90_000);

  it("retries a bootstrap that waited too long for a table lock (55P03)", async () => {
    // A fresh process boots against a database where another session holds a table lock the
    // migrations need -- an old release still writing during an upgrade.
    await resetDatabaseConnectionsForTests();
    const holder = runDocker([
      "exec",
      containerName,
      "psql",
      "-U",
      "stream247",
      "-d",
      "stream247",
      "-c",
      "BEGIN; LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(7); COMMIT;"
    ]);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const held = await psql(
        "SELECT COUNT(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'schema_migrations' AND l.mode = 'AccessExclusiveLock' AND l.granted"
      );
      if (held === "1") {
        break;
      }
      await sleep(100);
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const startedAt = Date.now();
    let warnings: string[] = [];
    try {
      await expect(ensureDatabase()).resolves.toBeUndefined();
    } finally {
      warnings = warn.mock.calls.map(([line]) => String(line));
      warn.mockRestore();
    }
    await holder;

    // The first attempt gave up after the 5 s lock timeout instead of waiting for the lock, and the
    // retry went through once the lock was released.
    expect(warnings.some((line) => line.includes("database bootstrap retrying after PostgreSQL 55P03"))).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4_500);
    expect(await getDatabaseHealth()).toBe("ok");
  }, 60_000);

  it("worker, playout and uplink keep running through a 45 s Postgres stop (R3 S1)", async () => {
    expect(existsSync(workerEntry), `${workerEntry} is missing: build the worker first (pnpm typecheck)`).toBe(true);

    const modes = ["worker", "playout", "uplink"] as const;
    const logs: Record<string, string> = {};
    const exits: Record<string, number | null> = {};
    for (const mode of modes) {
      const cwd = path.join(workDir, mode);
      mkdirSync(path.join(cwd, "media"), { recursive: true });
      logs[mode] = "";
      const child = spawn(process.execPath, [workerEntry, mode], {
        cwd,
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL,
          APP_SECRET: testAppSecret,
          MEDIA_LIBRARY_ROOT: path.join(cwd, "media"),
          NODE_ENV: "production"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout?.on("data", (chunk) => (logs[mode] += String(chunk)));
      child.stderr?.on("data", (chunk) => (logs[mode] += String(chunk)));
      child.on("exit", (code) => (exits[mode] = code));
      children.push(child);
    }

    const heartbeats = async () => {
      const row = await psql("SELECT worker_heartbeat_at, heartbeat_at, uplink_heartbeat_at FROM playout_runtime");
      const [worker = "", playout = "", uplink = ""] = row.split("|");
      return { worker, playout, uplink };
    };
    const waitForHeartbeatsAfter = async (since: string) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const beats = await heartbeats();
        if (modes.every((mode) => beats[mode] > since)) {
          return beats;
        }
        await sleep(1_000);
      }
      throw new Error(`No heartbeat from every mode after ${since}: ${JSON.stringify(await heartbeats())}`);
    };

    // Every mode completed a cycle against the database before the outage.
    await waitForHeartbeatsAfter("");

    await runDocker(["stop", "-t", "5", containerName]);
    await sleep(45_000);

    // Each process hit the outage (a failed cycle that could not record its incident) and is still
    // running: before M86 the first such cycle exited it.
    for (const mode of modes) {
      expect(exits[mode], `${mode} exited during the outage:\n${logs[mode].slice(-2000)}`).toBeUndefined();
      expect(logs[mode]).toContain('"event":"worker.loop.database_unreachable"');
      expect(logs[mode]).not.toContain('"event":"worker.process.failed"');
    }

    await runDocker(["start", containerName]);
    await waitForPostgres();
    const restartedAt = new Date().toISOString();

    // And each comes back by itself: a completed cycle writes its heartbeat again.
    await waitForHeartbeatsAfter(restartedAt);
    for (const mode of modes) {
      expect(exits[mode], `${mode} exited after the outage:\n${logs[mode].slice(-2000)}`).toBeUndefined();
    }
  }, 240_000);
});
