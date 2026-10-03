// M95 (H5): state incidents a previous worker left open close on their own once the condition is gone.
//
// Before M95 the disk watermark and the system-volume watch kept "my incident is open" in memory only, so
// after a restart they never resolved the row; and `secrets.key-mismatch` was only ever raised, so it stayed
// critical after the APP_SECRET was restored. Here the built worker binary runs against a real
// postgres:16-alpine with all three seeded open, thresholds set so that any test machine has free space.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createCipheriv, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureDatabase,
  resetDatabaseConnectionsForTests,
  resetSecretDecryptionFailureForTests,
  resolveSecretKeyMismatchWhenSecretsDecrypt,
  upsertIncident
} from "@stream247/db";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const workerEntry = path.join(repoRoot, "apps/worker/dist/index.js");
const testAppSecret = "stream247-m95-self-healing-secret-0123456789";
const foreignAppSecret = "stream247-m95-some-other-secret-9876543210";

// The derivation the store uses (getEncryptionKey), so this seals exactly what it would.
function sealWith(secret: string, plaintext: string): string {
  const key = scryptSync(secret, "stream247-managed-config", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), payload.toString("base64url")].join(":");
}

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args);
  return stdout.trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.sequential("self-healing state incidents (M95, H5)", () => {
  const containerName = `stream247-m95-${randomUUID().slice(0, 8)}`;
  let workDir = "";
  let child: ChildProcess | null = null;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAppSecret = process.env.APP_SECRET;

  async function psql(sql: string): Promise<string> {
    return runDocker(["exec", containerName, "psql", "-U", "stream247", "-d", "stream247", "-Atc", sql]);
  }

  async function incidentStatus(fingerprint: string): Promise<string> {
    return psql(`SELECT status FROM incidents WHERE fingerprint = '${fingerprint}'`);
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
    resetSecretDecryptionFailureForTests();
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
    workDir = mkdtempSync(path.join(os.tmpdir(), "stream247-m95-"));
  }, 60_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await resetDatabaseConnectionsForTests();
    resetSecretDecryptionFailureForTests();
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.APP_SECRET = originalAppSecret;
    await runDocker(["rm", "-f", containerName]).catch(() => {});
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps secrets.key-mismatch open while one stored secret fails, and closes it once all decrypt", async () => {
    // Nothing open, nothing read.
    expect((await resolveSecretKeyMismatchWhenSecretsDecrypt()).outcome).toBe("none");

    await upsertIncident({
      scope: "system",
      severity: "critical",
      title: "Stored secrets cannot be decrypted with the current APP_SECRET",
      message: "seeded by the M95 test",
      fingerprint: "secrets.key-mismatch"
    });
    await psql(
      `INSERT INTO managed_secrets (id, encrypted_value, created_at) VALUES ('m95-probe', '${sealWith(foreignAppSecret, "old")}', now()::text)`
    );

    const stillWrong = await resolveSecretKeyMismatchWhenSecretsDecrypt();
    expect(stillWrong).toMatchObject({ outcome: "open", failed: 1 });
    expect(await incidentStatus("secrets.key-mismatch")).toBe("open");

    // The secret that sealed it is back (here: the value re-entered under the current one). The worker
    // closes it at its next start, below.
    await psql(`UPDATE managed_secrets SET encrypted_value = '${sealWith(testAppSecret, "new")}' WHERE id = 'm95-probe'`);
    await resetDatabaseConnectionsForTests();
  }, 60_000);

  it("closes the disk, system-volume and key-mismatch incidents a previous worker left open on its first cycle", async () => {
    expect(existsSync(workerEntry), `${workerEntry} is missing: build the worker first (pnpm typecheck)`).toBe(true);

    for (const [fingerprint, title] of [
      ["disk.watermark.evicted", "Low disk space triggered media eviction"],
      ["system.volume.low", "System volume is running out of space"]
    ] as const) {
      await upsertIncident({ scope: "system", severity: "critical", title, message: "seeded by the M95 test", fingerprint });
    }
    expect(await incidentStatus("disk.watermark.evicted")).toBe("open");
    expect(await incidentStatus("system.volume.low")).toBe("open");
    expect(await incidentStatus("secrets.key-mismatch")).toBe("open");
    await resetDatabaseConnectionsForTests();

    const cwd = path.join(workDir, "worker");
    mkdirSync(path.join(cwd, "media"), { recursive: true });
    let log = "";
    child = spawn(process.execPath, [workerEntry, "worker"], {
      cwd,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
        APP_SECRET: testAppSecret,
        MEDIA_LIBRARY_ROOT: path.join(cwd, "media"),
        // Any machine running this has more than 2 % free, so both monitors measure "healthy".
        STREAM247_DISK_WATERMARK_TRIGGER_PERCENT: "1",
        STREAM247_DISK_WATERMARK_RECOVER_PERCENT: "2",
        STREAM247_SYSTEM_VOLUME_TRIGGER_PERCENT: "1",
        STREAM247_SYSTEM_VOLUME_RECOVER_PERCENT: "2",
        NODE_ENV: "production"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.on("data", (chunk) => (log += String(chunk)));
    child.stderr?.on("data", (chunk) => (log += String(chunk)));

    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (await psql("SELECT worker_heartbeat_at FROM playout_runtime")) {
        break;
      }
      await sleep(1_000);
    }
    expect(await psql("SELECT worker_heartbeat_at FROM playout_runtime"), log.slice(-3000)).not.toBe("");

    expect(await incidentStatus("disk.watermark.evicted"), log.slice(-3000)).toBe("resolved");
    expect(await incidentStatus("system.volume.low"), log.slice(-3000)).toBe("resolved");
    expect(await incidentStatus("secrets.key-mismatch"), log.slice(-3000)).toBe("resolved");
    expect(log).toContain('"event":"incident.state_flags.rearmed"');
    expect(log).toContain('"secretKeyMismatch":"resolved"');
    expect(log).not.toContain('"event":"worker.step.failed"');
  }, 150_000);
});
