import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const rootDir = path.resolve(__dirname, "../..");
const scriptPath = path.join(rootDir, "scripts", "release-preflight.sh");
const tempDirs: string[] = [];

function createDockerStub(tempDir: string) {
  const binDir = path.join(tempDir, "bin");
  const dockerLog = path.join(tempDir, "docker.log");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, "docker"),
    `#!/usr/bin/env sh
printf '%s\\n' "$*" >> "${dockerLog}"
exit 0
`
  );
  chmodSync(path.join(binDir, "docker"), 0o755);
  return {
    binDir,
    dockerLog
  };
}

function runReleasePreflight(envContents: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "stream247-release-preflight-"));
  tempDirs.push(tempDir);

  const envFile = path.join(tempDir, "release.env");
  writeFileSync(envFile, envContents);

  const { binDir, dockerLog } = createDockerStub(tempDir);

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

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { force: true, recursive: true });
  }
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
`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("APP_SECRET is blank");
  });

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
});
