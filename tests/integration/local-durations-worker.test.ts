// M96 (U4): local-library files carry their real length.
//
// Measured in the research (planning/research/ux-install.md, U4): three short local files stored
// `duration_seconds = 0`, so the Day lens read "Unique library: 90m" (three 30-minute estimates) for six
// minutes of video. Here the built worker binary scans three generated two-minute files against a real
// postgres:16-alpine: each row stores 120 s with its file version, the second scan probes nothing, and
// the Day lens computed from the stored state reads 6m.
//
// Needs ffmpeg on the host to generate the files (locally, and in the worker image); CI's validate job has
// none, so there this file skips and tests/unit/local-durations.test.ts carries the logic.
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMaterializedProgrammingWeek } from "@stream247/core";
import { ensureDatabase, readAppState, resetDatabaseConnectionsForTests } from "@stream247/db";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const workerEntry = path.join(repoRoot, "apps/worker/dist/index.js");
const ffmpegAvailable =
  spawnSync("ffmpeg", ["-hide_banner", "-version"]).status === 0 && spawnSync("ffprobe", ["-hide_banner", "-version"]).status === 0;

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args);
  return stdout.trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.runIf(ffmpegAvailable).sequential("local file durations in the worker scan (M96)", () => {
  const containerName = `stream247-m96-${randomUUID().slice(0, 8)}`;
  let workDir = "";
  let child: ChildProcess | null = null;
  const originalDatabaseUrl = process.env.DATABASE_URL;

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
    await resetDatabaseConnectionsForTests();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await ensureDatabase();
        break;
      } catch (error) {
        if (attempt >= 20) {
          throw error;
        }
        await resetDatabaseConnectionsForTests();
        await sleep(500);
      }
    }

    workDir = mkdtempSync(path.join(os.tmpdir(), "stream247-m96-"));
    const media = path.join(workDir, "worker", "media");
    mkdirSync(media, { recursive: true });
    const first = path.join(media, "folge-1.mp4");
    const generated = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x36:r=5",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=8000:cl=mono",
        "-t",
        "120",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-shortest",
        "-y",
        first
      ],
      { encoding: "utf8" }
    );
    expect(generated.status, generated.stderr).toBe(0);
    copyFileSync(first, path.join(media, "folge-2.mp4"));
    copyFileSync(first, path.join(media, "folge-3.mp4"));
  }, 120_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await resetDatabaseConnectionsForTests();
    process.env.DATABASE_URL = originalDatabaseUrl;
    await runDocker(["rm", "-f", containerName]).catch(() => {});
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("stores 120 s for each of three two-minute files, probes them once, and the Day lens reads 6m", async () => {
    expect(existsSync(workerEntry), `${workerEntry} is missing: build the worker first (pnpm typecheck)`).toBe(true);

    const cwd = path.join(workDir, "worker");
    let log = "";
    child = spawn(process.execPath, [workerEntry, "worker"], {
      cwd,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
        APP_SECRET: "stream247-m96-local-durations-secret-0123456789",
        MEDIA_LIBRARY_ROOT: path.join(cwd, "media"),
        NODE_ENV: "production"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.on("data", (chunk) => (log += String(chunk)));
    child.stderr?.on("data", (chunk) => (log += String(chunk)));

    const durations = () =>
      psql("SELECT title || '=' || duration_seconds FROM assets WHERE source_id = 'source-local-library' ORDER BY title");
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if ((await durations()).split("\n").filter(Boolean).length === 3) {
        break;
      }
      await sleep(1_000);
    }
    expect((await durations()).split("\n"), log.slice(-3000)).toEqual(["folge 1=120", "folge 2=120", "folge 3=120"]);
    expect(await psql("SELECT COUNT(*) FROM assets WHERE source_id = 'source-local-library' AND duration_probe_key ~ '^[0-9]+:[0-9]+$'")).toBe(
      "3"
    );

    // Wait for the next cycle's scan (the worker loop runs every 30 s): it must not probe again.
    const firstHeartbeat = await psql("SELECT worker_heartbeat_at FROM playout_runtime");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if ((await psql("SELECT worker_heartbeat_at FROM playout_runtime")) !== firstHeartbeat) {
        break;
      }
      await sleep(1_000);
    }
    expect(await psql("SELECT worker_heartbeat_at FROM playout_runtime"), log.slice(-3000)).not.toBe(firstHeartbeat);
    const probeEvents = log.split("\n").filter((line) => line.includes('"event":"local-library.durations.probed"'));
    expect(probeEvents, log.slice(-3000)).toHaveLength(1);
    expect(probeEvents[0]).toContain('"probed":3');

    // The Day lens over the stored state: one 24-hour block of a pool holding the three files.
    await resetDatabaseConnectionsForTests();
    const state = await readAppState();
    const assets = state.assets.filter((asset) => asset.sourceId === "source-local-library");
    const day = buildMaterializedProgrammingWeek({
      startDate: "2026-10-05",
      blocks: [
        {
          id: "block-local",
          title: "Local library",
          categoryName: "Archive",
          sourceName: "Pool",
          dayOfWeek: 1,
          startMinuteOfDay: 0,
          durationMinutes: 24 * 60,
          poolId: "pool-local"
        }
      ],
      pools: [
        {
          id: "pool-local",
          name: "Local",
          sourceIds: ["source-local-library"],
          cursorAssetId: "",
          insertAssetId: "",
          insertEveryItems: 0,
          itemsSinceInsert: 0
        }
      ],
      assets
    })[0];
    // The line apps/web/app/(admin)/schedule/page.tsx prints for the block.
    expect(`Unique library: ${String(day?.blocks[0]?.uniqueMinutes)}m`).toBe("Unique library: 6m");
  }, 180_000);
});
