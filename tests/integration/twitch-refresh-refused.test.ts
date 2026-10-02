// M87: an external failure costs one step, not the cycle.
//
// R3's S2 run (planning/research/robustness.md, "S2 evidence") as a test: the built worker binary
// against a real postgres:16-alpine, the bot connection seeded "connected" with an access token that
// expired a minute ago, and a fetch preload that answers Twitch's token endpoint with HTTP 400
// "Invalid refresh token". Before M87 every cycle ended in `worker.loop.crashed`, no heartbeat was
// written and `healthcheck worker` failed; the connection still read "connected".
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAppState, resetDatabaseConnectionsForTests, updateTwitchConnectionRecord, upsertIncident } from "@stream247/db";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const workerEntry = path.join(repoRoot, "apps/worker/dist/index.js");
const testAppSecret = "stream247-m87-refresh-test-secret-0123456789";

// Only Twitch is stubbed: the refresh grant is refused, every other Twitch request (the live-status
// app token, Helix) answers 503 at once, so nothing waits on a network the test does not have.
const fetchStub = `
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
    const grant = new URLSearchParams(String(init?.body ?? "")).get("grant_type");
    console.log(JSON.stringify({ event: "m87-stub.token", grant }));
    if (grant === "refresh_token") {
      return new Response('{"status":400,"message":"Invalid refresh token"}', { status: 400 });
    }
    return new Response("stubbed", { status: 503 });
  }
  if (/^https:\\/\\/[^/]*twitch\\.tv\\//.test(url)) {
    return new Response("stubbed", { status: 503 });
  }
  return realFetch(input, init);
};
`;

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args);
  return stdout.trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.sequential("a refused Twitch refresh token (M87, R3 S2)", () => {
  const containerName = `stream247-m87-${randomUUID().slice(0, 8)}`;
  let workDir = "";
  let child: ChildProcess | null = null;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAppSecret = process.env.APP_SECRET;

  async function psql(sql: string): Promise<string> {
    return runDocker(["exec", containerName, "psql", "-U", "stream247", "-d", "stream247", "-Atc", sql]);
  }

  beforeAll(async () => {
    await runDocker([
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      "POSTGRES_DB=stream247",
      "-e",
      "POSTGRES_USER=stream247",
      "-e",
      "POSTGRES_PASSWORD=stream247",
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine"
    ]);
    const port = (await runDocker(["port", containerName, "5432/tcp"])).split(":").pop();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await runDocker(["exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", "stream247", "-d", "stream247"]);
        break;
      } catch {
        await sleep(500);
      }
    }
    process.env.DATABASE_URL = `postgresql://stream247:stream247@127.0.0.1:${port}/stream247`;
    process.env.APP_SECRET = testAppSecret;
    await resetDatabaseConnectionsForTests();
    workDir = mkdtempSync(path.join(os.tmpdir(), "stream247-m87-"));
  }, 60_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await resetDatabaseConnectionsForTests();
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.APP_SECRET = originalAppSecret;
    await runDocker(["rm", "-f", containerName]).catch(() => {});
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps the worker cycle alive, sets the connection to error and asks for a reconnect", async () => {
    expect(existsSync(workerEntry), `${workerEntry} is missing: build the worker first (pnpm typecheck)`).toBe(true);

    // The S2 seed: a connected bot account whose access token expired a minute ago.
    const state = await readAppState();
    await updateTwitchConnectionRecord({
      ...state.twitch,
      status: "connected",
      broadcasterId: "1000001",
      broadcasterLogin: "m87bot",
      accessToken: "m87-expired-access-token",
      refreshToken: "m87-revoked-refresh-token",
      connectedAt: new Date(Date.now() - 86_400_000).toISOString(),
      tokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      error: ""
    });
    // A past worker event, old enough for the incident sweep to close it once the worker is healthy:
    // proof that the sweep after the heartbeat ran.
    await upsertIncident({
      scope: "worker",
      severity: "critical",
      title: "worker loop stalled",
      message: "seeded by the M87 test",
      fingerprint: "worker.loop.stalled"
    });
    const longAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await psql(`UPDATE incidents SET created_at = '${longAgo}', updated_at = '${longAgo}' WHERE fingerprint = 'worker.loop.stalled'`);
    await resetDatabaseConnectionsForTests();

    const stubPath = path.join(workDir, "fetch-stub.mjs");
    writeFileSync(stubPath, fetchStub);
    const cwd = path.join(workDir, "worker");
    mkdirSync(path.join(cwd, "media"), { recursive: true });
    let log = "";
    child = spawn(process.execPath, ["--import", stubPath, workerEntry, "worker"], {
      cwd,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
        APP_SECRET: testAppSecret,
        MEDIA_LIBRARY_ROOT: path.join(cwd, "media"),
        TWITCH_CLIENT_ID: "m87-client-id",
        TWITCH_CLIENT_SECRET: "m87-client-secret",
        NODE_ENV: "production"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.on("data", (chunk) => (log += String(chunk)));
    child.stderr?.on("data", (chunk) => (log += String(chunk)));

    // Two cycles: the first meets the refusal, the second runs with the connection in error.
    const heartbeats = new Set<string>();
    for (let attempt = 0; attempt < 90 && heartbeats.size < 2; attempt += 1) {
      const beat = await psql("SELECT worker_heartbeat_at FROM playout_runtime");
      if (beat) {
        heartbeats.add(beat);
      }
      await sleep(1_000);
    }
    expect(heartbeats.size, `fewer than two worker cycles wrote a heartbeat:\n${log.slice(-3000)}`).toBe(2);
    expect(child.exitCode, log.slice(-3000)).toBeNull();

    const health = await execFileAsync(process.execPath, [workerEntry, "healthcheck", "worker"], {
      cwd,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, APP_SECRET: testAppSecret }
    }).then(
      () => 0,
      (error: { code?: number }) => error.code ?? 1
    );
    expect(health).toBe(0);

    expect(log).toContain('"grant":"refresh_token"');
    expect(log).toContain('"event":"twitch.refresh.failed"');
    expect(log).toContain('"event":"twitch.refresh.refused"');
    expect(log).not.toContain('"event":"worker.loop.crashed"');

    const incidents = await psql("SELECT fingerprint || '|' || status FROM incidents ORDER BY fingerprint");
    const rows = incidents.split("\n");
    expect(rows).toContain("twitch.refresh.failed|open");
    expect(rows).toContain("twitch.reconnect.required|open");
    expect(rows).toContain("worker.loop.stalled|resolved");
    expect(rows.some((row) => row.startsWith("worker.loop.crashed"))).toBe(false);

    const connection = await psql("SELECT status || '|' || error FROM twitch_connection");
    expect(connection).toBe(
      "error|Twitch refused the stored refresh token. Reconnect the account under Admin → Settings → Twitch accounts."
    );
  }, 150_000);
});
