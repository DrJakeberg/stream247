// M91 "Honest first run" against a real postgres:16-alpine:
//
// - I1 (decided 5.1 Q5): an empty database bootstraps with only the local library; an install that
//   already has rows (the demo rows seeded before M91 included) keeps them through a restart.
// - I7 (decided 5.1 Q8): the documented reset command, the built worker entry
//   `apps/worker/dist/reset-owner-password.js`, sets a new owner password, and the real sign-in route
//   accepts it.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPoolRecord,
  createScheduleBlocks,
  ensureDatabase,
  hashPassword,
  readAppState,
  resetDatabaseConnectionsForTests,
  updateOwnerAndInitialized,
  upsertSources,
  upsertUserRecord
} from "@stream247/db";

const cookieWrites = vi.hoisted(() => [] as Array<{ name: string; value: string }>);

vi.mock("../../apps/web/node_modules/next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string) => {
      cookieWrites.push({ name, value });
    },
    delete: () => undefined
  })
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  }
}));

import { POST as signIn } from "../../apps/web/app/api/auth/login/route";
import { clearAllRateLimits } from "../../apps/web/lib/server/rate-limit";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const resetEntry = path.join(repoRoot, "apps/worker/dist/reset-owner-password.js");
const testAppSecret = "stream247-m91-first-run-test-secret-0123456789";

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args);
  return stdout.trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function runReset(input: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resetEntry], {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function signInWith(email: string, password: string): Promise<number> {
  clearAllRateLimits();
  const response = await signIn({
    json: async () => ({ email, password }),
    headers: new Headers()
  } as never);
  return response.status;
}

describe.sequential("first run (M91)", () => {
  const containerName = `stream247-m91-${randomUUID().slice(0, 8)}`;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAppSecret = process.env.APP_SECRET;

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
  }, 60_000);

  afterAll(async () => {
    await resetDatabaseConnectionsForTests();
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.APP_SECRET = originalAppSecret;
    await runDocker(["rm", "-f", containerName]).catch(() => {});
  }, 30_000);

  it("bootstraps an empty database with the local library only", async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await ensureDatabase();
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await resetDatabaseConnectionsForTests();
        await sleep(400 * (attempt + 1));
      }
    }
    expect(lastError).toBeUndefined();

    const state = await readAppState();
    expect(state.sources.map((source) => source.id)).toEqual(["source-local-library"]);
    expect(state.pools).toEqual([]);
    expect(state.scheduleBlocks).toEqual([]);
    // Its own limit like the tests around it: the retry loop above alone can wait 6 s, and the first
    // bootstrap of an empty database took 5004 ms under the full suite on 2026-10-06 (the default is 5 s).
  }, 60_000);

  it("keeps an existing install's rows, the old demo rows included, through a restart", async () => {
    // The rows the seed wrote before M91, as an install from then carries them.
    await upsertSources([
      { id: "source-youtube", name: "YouTube Playlist", type: "Managed ingestion", connectorKind: "youtube-playlist", enabled: true, status: "Planned", externalUrl: "", notes: "" },
      { id: "source-twitch", name: "Twitch Archive", type: "Twitch VOD sync", connectorKind: "twitch-vod", enabled: true, status: "Planned", externalUrl: "", notes: "" }
    ]);
    await createPoolRecord({
      id: "pool-archive",
      name: "Archive Pool",
      sourceIds: ["source-twitch", "source-youtube"],
      playbackMode: "round-robin",
      cursorAssetId: "",
      insertAssetId: "",
      insertEveryItems: 0,
      itemsSinceInsert: 0,
      updatedAt: ""
    });
    await createScheduleBlocks([
      { id: "morning-vods", title: "Morning Twitch VOD Rotation", categoryName: "Just Chatting", dayOfWeek: 1, startMinuteOfDay: 360, durationMinutes: 240, poolId: "pool-archive", sourceName: "Twitch Archive" },
      { id: "playlist-prime", title: "Prime Time YouTube Playlist", categoryName: "Music", dayOfWeek: 5, startMinuteOfDay: 1080, durationMinutes: 360, poolId: "pool-archive", sourceName: "YouTube Playlist" }
    ]);

    // A restart: new connections, the bootstrap runs again.
    await resetDatabaseConnectionsForTests();
    await ensureDatabase();

    const state = await readAppState();
    expect(state.sources.map((source) => source.id).sort()).toEqual(["source-local-library", "source-twitch", "source-youtube"]);
    expect(state.pools.map((pool) => pool.id)).toEqual(["pool-archive"]);
    expect(state.scheduleBlocks.map((block) => block.id).sort()).toEqual(["morning-vods", "playlist-prime"]);
  });

  it("resets the owner password with the container command, and the sign-in accepts the new one", async () => {
    expect(existsSync(resetEntry), `${resetEntry} is missing: build the worker first (pnpm typecheck)`).toBe(true);

    const email = "owner@example.com";
    const oldHash = hashPassword("forgotten-password-1");
    const createdAt = "2026-10-03T10:00:00.000Z";
    await updateOwnerAndInitialized({ initialized: true, owner: { email, passwordHash: oldHash, createdAt } });
    await upsertUserRecord({
      id: "user_owner",
      email,
      displayName: "Owner",
      authProvider: "local",
      role: "owner",
      twitchUserId: "",
      twitchLogin: "",
      passwordHash: oldHash,
      createdAt,
      lastLoginAt: createdAt
    });
    expect(await signInWith(email, "forgotten-password-1")).toBe(200);

    const tooShort = await runReset("short\n");
    expect(tooShort.code).toBe(2);
    expect(await signInWith(email, "forgotten-password-1")).toBe(200);

    const reset = await runReset("brand-new-password-91\n");
    expect(reset.stderr).toBe("");
    expect(reset.code).toBe(0);
    expect(reset.stdout).toContain(`The owner password for ${email} is reset.`);
    expect(reset.stdout).not.toContain("brand-new-password-91");

    cookieWrites.length = 0;
    expect(await signInWith(email, "brand-new-password-91")).toBe(200);
    expect(cookieWrites.map((cookie) => cookie.name)).toEqual(["stream247_session"]);
    expect(await signInWith(email, "forgotten-password-1")).toBe(401);

    const state = await readAppState();
    expect(state.auditEvents.some((event) => event.type === "auth.password.reset")).toBe(true);
  }, 60_000);
});
