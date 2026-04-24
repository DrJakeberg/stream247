import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const rootDir = path.resolve(__dirname, "../..");
const rootEnvPath = path.join(rootDir, ".env");
const rootEnvLockPath = path.join(os.tmpdir(), "stream247-release-root-env.lock");
const scriptPath = path.join(rootDir, "scripts", "release-preflight.sh");
const prepareEnvScriptPath = path.join(rootDir, "scripts", "prepare-release-preflight-env.sh");
const tempDirs: string[] = [];
let rootEnvBackupPath: string | null = null;
let rootEnvLockHeld = false;

function acquireRootEnvLock() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      mkdirSync(rootEnvLockPath);
      rootEnvLockHeld = true;
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }

  throw new Error(`Timed out waiting for ${rootEnvLockPath}`);
}

function releaseRootEnvLock() {
  if (!rootEnvLockHeld) {
    return;
  }

  rmSync(rootEnvLockPath, { force: true, recursive: true });
  rootEnvLockHeld = false;
}

function createDockerStub(tempDir: string, options?: { requireRootEnvDuringConfig?: boolean }) {
  const binDir = path.join(tempDir, "bin");
  const dockerLog = path.join(tempDir, "docker.log");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, "docker"),
    `#!/usr/bin/env sh
printf '%s\\n' "$*" >> "${dockerLog}"
if [ "${options?.requireRootEnvDuringConfig ? "1" : "0"}" = "1" ]; then
  case "$*" in
    *"compose --env-file "*config*)
      if [ ! -f "${rootEnvPath}" ]; then
        echo "expected ${rootEnvPath} to exist during compose config" >&2
        exit 1
      fi
      ;;
  esac
fi
exit 0
`
  );
  chmodSync(path.join(binDir, "docker"), 0o755);
  return {
    binDir,
    dockerLog
  };
}

function runReleasePreflightFile(envFile: string, tempDir: string, options?: { requireRootEnvDuringConfig?: boolean }) {
  const { binDir, dockerLog } = createDockerStub(tempDir, options);

  try {
    const output = execFileSync("sh", [scriptPath], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        RELEASE_PREFLIGHT_ENV_FILE: envFile,
        RELEASE_PREFLIGHT_SKIP_VALIDATE: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    return {
      status: 0,
      output,
      dockerLog: existsSync(dockerLog) ? readFileSync(dockerLog, "utf8") : "",
      envFile
    };
  } catch (error) {
    const execError = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      status: execError.status ?? 1,
      output: `${execError.stdout?.toString() ?? ""}${execError.stderr?.toString() ?? ""}`,
      dockerLog: existsSync(dockerLog) ? readFileSync(dockerLog, "utf8") : "",
      envFile
    };
  }
}

function runReleasePreflight(envContents: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "stream247-release-preflight-"));
  tempDirs.push(tempDir);

  const envFile = path.join(tempDir, "release.env");
  writeFileSync(envFile, envContents);

  return runReleasePreflightFile(envFile, tempDir);
}

function prepareReleasePreflightEnv(sourceEnvFile?: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "stream247-release-preflight-helper-"));
  tempDirs.push(tempDir);

  const args = sourceEnvFile ? [prepareEnvScriptPath, sourceEnvFile] : [prepareEnvScriptPath];
  const envFile = execFileSync("sh", args, {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      TMPDIR: tempDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();

  return { envFile, tempDir };
}

function moveRootEnvOutOfTheWay(tempDir: string) {
  if (!existsSync(rootEnvPath)) {
    rootEnvBackupPath = null;
    return;
  }

  rootEnvBackupPath = path.join(tempDir, "root.env.backup");
  renameSync(rootEnvPath, rootEnvBackupPath);
}

beforeEach(() => {
  acquireRootEnvLock();
}, 30_000);

afterEach(() => {
  if (rootEnvBackupPath && existsSync(rootEnvBackupPath)) {
    renameSync(rootEnvBackupPath, rootEnvPath);
  }
  rootEnvBackupPath = null;

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { force: true, recursive: true });
  }

  releaseRootEnvLock();
});

describe("release preflight", () => {
  it("rejects blank required production settings", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=
POSTGRES_PASSWORD=super-secret-db-password
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:v1.0.3
STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
STREAM247_RELAY_IMAGE=bluenviron/mediamtx:1.15.4
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("APP_SECRET is blank");
  }, 30_000);

  it("rejects quoted double-empty required production settings", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=""
POSTGRES_PASSWORD=super-secret-db-password
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:v1.0.3
STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("APP_SECRET is blank");
  });

  it("rejects quoted single-empty required production settings", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=super-secret-app-secret-0123456789
POSTGRES_PASSWORD=''
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:v1.0.3
STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("POSTGRES_PASSWORD is blank");
  });

  it("rejects untouched production example configs", () => {
    const result = runReleasePreflight(readFileSync(path.join(rootDir, ".env.production.example"), "utf8"));

    expect(result.status).toBe(1);
    expect(result.output).toContain("APP_URL still uses an example or placeholder value");
  });

  it("rejects development placeholder configs copied from .env.example", () => {
    const result = runReleasePreflight(readFileSync(path.join(rootDir, ".env.example"), "utf8"));

    expect(result.status).toBe(1);
    expect(result.output).toContain("APP_URL still uses an example or placeholder value");
  });

  it("rejects proxy host placeholder values when Traefik settings are present", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=super-secret-app-secret-0123456789
POSTGRES_PASSWORD=super-secret-db-password
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
TRAEFIK_HOST=stream247.example.com
TRAEFIK_ACME_EMAIL=ops@mycorp.net
STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:v1.0.3
STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("TRAEFIK_HOST still uses an example or placeholder value");
  });

  it("rejects proxy email placeholder values when Traefik settings are present", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=super-secret-app-secret-0123456789
POSTGRES_PASSWORD=super-secret-db-password
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
TRAEFIK_HOST=stream247.mycorp.net
TRAEFIK_ACME_EMAIL=admin@example.com
STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:v1.0.3
STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("TRAEFIK_ACME_EMAIL still uses an example or placeholder value");
  });

  it("rejects blank proxy email when the letsencrypt resolver is active", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=super-secret-app-secret-0123456789
POSTGRES_PASSWORD=super-secret-db-password
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
TRAEFIK_HOST=stream247.mycorp.net
TRAEFIK_CERT_RESOLVER=letsencrypt
STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:v1.0.3
STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("TRAEFIK_ACME_EMAIL is blank");
  });

  it("accepts a non-acme resolver without a Traefik ACME email", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=super-secret-app-secret-0123456789
POSTGRES_PASSWORD=super-secret-db-password
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
TRAEFIK_HOST=stream247.mycorp.net
TRAEFIK_CERT_RESOLVER=cf
STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:v1.0.3
STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
`);

    expect(result.status).toBe(0);
    expect(result.output).toContain("Release preflight succeeded.");
  });

  it("rejects unquoted mutable latest image tags", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=super-secret-app-secret-0123456789
POSTGRES_PASSWORD=super-secret-db-password
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:latest
STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("STREAM247_WEB_IMAGE still points to mutable tag :latest");
  });

  it("rejects quoted mutable latest image tags", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=super-secret-app-secret-0123456789
POSTGRES_PASSWORD=super-secret-db-password
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
STREAM247_WEB_IMAGE="ghcr.io/drjakeberg/stream247-web:v1.0.3"
STREAM247_WORKER_IMAGE='ghcr.io/drjakeberg/stream247-worker:latest'
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("STREAM247_WORKER_IMAGE still points to mutable tag :latest");
  });

  it("accepts pinned production values and forwards the selected env file to docker compose", () => {
    const result = runReleasePreflight(`
APP_URL=https://stream247.mycorp.net
APP_SECRET=super-secret-app-secret-0123456789
POSTGRES_PASSWORD=super-secret-db-password
DATABASE_URL=postgresql://stream247:super-secret-db-password@postgres:5432/stream247
TRAEFIK_HOST=stream247.mycorp.net
TRAEFIK_ACME_EMAIL=ops@mycorp.net
STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:v1.0.3
STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3
STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3
`);

    expect(result.status).toBe(0);
    expect(result.output).toContain("Release preflight succeeded.");
    expect(result.dockerLog).toContain(`compose --env-file ${result.envFile} config`);
  });

  it("prepares a staged workflow env from the production example that passes preflight", () => {
    const prepared = prepareReleasePreflightEnv();
    const envContents = readFileSync(prepared.envFile, "utf8");

    expect(envContents).toContain("APP_URL=https://stream247-ci.test");
    expect(envContents).toContain("APP_SECRET=ci-release-preflight-secret-0123456789");
    expect(envContents).toContain("POSTGRES_PASSWORD=ci-release-preflight-db-password");
    expect(envContents).toContain("DATABASE_URL=postgresql://stream247:ci-release-preflight-db-password@postgres:5432/stream247");
    expect(envContents).toContain("STREAM247_RELAY_IMAGE=bluenviron/mediamtx:1.15.4");
    expect(envContents).toContain("TRAEFIK_HOST=stream247-ci.test");
    expect(envContents).toContain("TRAEFIK_ACME_EMAIL=ops@stream247-ci.test");

    const result = runReleasePreflightFile(prepared.envFile, prepared.tempDir);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Release preflight succeeded.");
  });

  it("uses the selected staged env file for compose validation even when the root .env is absent", () => {
    const prepared = prepareReleasePreflightEnv();
    moveRootEnvOutOfTheWay(prepared.tempDir);

    expect(existsSync(rootEnvPath)).toBe(false);

    const result = runReleasePreflightFile(prepared.envFile, prepared.tempDir, {
      requireRootEnvDuringConfig: true
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain("Release preflight succeeded.");
    expect(result.dockerLog).toContain(`compose --env-file ${prepared.envFile} config`);
    expect(existsSync(rootEnvPath)).toBe(false);
  });

  it("still rejects placeholder production values when the root .env is absent", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "stream247-release-preflight-placeholder-"));
    tempDirs.push(tempDir);

    moveRootEnvOutOfTheWay(tempDir);

    const envFile = path.join(tempDir, "placeholder.env");
    writeFileSync(envFile, readFileSync(path.join(rootDir, ".env.production.example"), "utf8"));

    const result = runReleasePreflightFile(envFile, tempDir, {
      requireRootEnvDuringConfig: true
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain("APP_URL still uses an example or placeholder value");
    expect(existsSync(rootEnvPath)).toBe(false);
  });
});
