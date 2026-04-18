import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const rootDir = path.resolve(__dirname, "../..");
const rootEnvPath = path.join(rootDir, ".env");
const rootEnvLockPath = path.join(os.tmpdir(), "stream247-release-root-env.lock");
const ciWorkflowPath = path.join(rootDir, ".github", "workflows", "ci.yml");
const releaseWorkflowPath = path.join(rootDir, ".github", "workflows", "release.yml");
const composePath = path.join(rootDir, "docker-compose.yml");
const workerDockerfilePath = path.join(rootDir, "docker", "worker.Dockerfile");
const upgradeScriptPath = path.join(rootDir, "scripts", "upgrade-rehearsal.sh");
const soakScriptPath = path.join(rootDir, "scripts", "soak-monitor.sh");
const tempDirs: string[] = [];
let rootEnvLockHeld = false;

type RootEnvTestState = {
  backupPath: string | null;
  existedBeforeTest: boolean;
  managedByTest: boolean;
};

let rootEnvState: RootEnvTestState;

type CurlResponse = {
  body: string;
  status?: number;
};

type DockerStubOptions = {
  manifestAvailableRefs?: string[];
};

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

function rememberTempDir(prefix: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function createRootEnvTestState(rootPath: string): RootEnvTestState {
  return {
    backupPath: null,
    existedBeforeTest: existsSync(rootPath),
    managedByTest: false
  };
}

function writeManagedRootEnv(rootPath: string, state: RootEnvTestState, contents: string) {
  if (!state.managedByTest) {
    if (state.existedBeforeTest && existsSync(rootPath)) {
      const tempDir = rememberTempDir("stream247-release-readiness-root-");
      state.backupPath = path.join(tempDir, "root.env.backup");
      renameSync(rootPath, state.backupPath);
    }

    state.managedByTest = true;
  } else if (existsSync(rootPath)) {
    rmSync(rootPath, { force: true });
  }

  writeFileSync(rootPath, contents);
}

function restoreManagedRootEnv(rootPath: string, state: RootEnvTestState) {
  if (!state.managedByTest) {
    return;
  }

  if (existsSync(rootPath)) {
    rmSync(rootPath, { force: true });
  }

  if (state.backupPath && existsSync(state.backupPath)) {
    renameSync(state.backupPath, rootPath);
  }

  state.backupPath = null;
  state.managedByTest = false;
}

function writeRootEnv(contents: string) {
  writeManagedRootEnv(rootEnvPath, rootEnvState, contents);
}

function createDockerStub(tempDir: string, options: DockerStubOptions = {}) {
  const binDir = path.join(tempDir, "bin");
  const dockerLog = path.join(tempDir, "docker.log");
  const manifestRefsPath = path.join(tempDir, "manifest-refs.txt");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(manifestRefsPath, `${(options.manifestAvailableRefs ?? []).join("\n")}\n`);
  writeFileSync(
    path.join(binDir, "docker"),
    `#!/usr/bin/env sh
all_args="$*"
if [ "\${1:-}" = "manifest" ] && [ "\${2:-}" = "inspect" ]; then
  printf '%s\\n' "$all_args" >> "${dockerLog}"
  if grep -Fx "\${3:-}" "${manifestRefsPath}" >/dev/null 2>&1; then
    exit 0
  fi
  exit 1
fi

if [ "\${1:-}" = "compose" ]; then
  env_file=""
  while [ "\$#" -gt 0 ]; do
    if [ "\$1" = "--env-file" ] && [ "\$#" -ge 2 ]; then
      env_file="\$2"
      shift 2
      continue
    fi
    shift
  done
  if [ -n "$env_file" ] && [ -f "$env_file" ]; then
    grep '^STREAM247_.*_IMAGE=' "$env_file" | sed 's/^/ENV:/' >> "${dockerLog}" || true
  fi
fi

printf '%s\\n' "$all_args" >> "${dockerLog}"
exit 0
`
  );
  chmodSync(path.join(binDir, "docker"), 0o755);
  return { binDir, dockerLog };
}

function createSleepStub(binDir: string) {
  writeFileSync(
    path.join(binDir, "sleep"),
    `#!/usr/bin/env sh
exit 0
`
  );
  chmodSync(path.join(binDir, "sleep"), 0o755);
}

function createCurlStub(binDir: string, tempDir: string, responses: CurlResponse[]) {
  const responseDir = path.join(tempDir, "curl-responses");
  const counterFile = path.join(tempDir, "curl-count");
  mkdirSync(responseDir, { recursive: true });

  responses.forEach((response, index) => {
    writeFileSync(path.join(responseDir, `${index}.body`), response.body);
    writeFileSync(path.join(responseDir, `${index}.status`), String(response.status ?? 0));
  });

  writeFileSync(
    path.join(binDir, "curl"),
    `#!/usr/bin/env sh
count_file="${counterFile}"
index="$(cat "$count_file" 2>/dev/null || echo 0)"
max_index=${responses.length - 1}
if [ "$index" -gt "$max_index" ]; then
  index="$max_index"
fi
cat "${responseDir}/$index.body"
echo $((index + 1)) > "$count_file"
exit "$(cat "${responseDir}/$index.status")"
`
  );
  chmodSync(path.join(binDir, "curl"), 0o755);
}

function runShellScript(
  scriptPath: string,
  args: string[],
  responses: CurlResponse[],
  options: { docker?: DockerStubOptions; env?: Record<string, string> } = {}
) {
  const tempDir = rememberTempDir("stream247-release-readiness-script-");
  const { binDir, dockerLog } = createDockerStub(tempDir, options.docker);
  createSleepStub(binDir);
  createCurlStub(binDir, tempDir, responses);

  try {
    const output = execFileSync("sh", [scriptPath, ...args], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        CHECK_BASE_URL: "http://127.0.0.1:3000",
        ...options.env,
        PATH: `${binDir}:${process.env.PATH}`
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    return {
      status: 0,
      output,
      dockerLog: existsSync(dockerLog) ? readFileSync(dockerLog, "utf8") : ""
    };
  } catch (error) {
    const execError = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      status: execError.status ?? 1,
      output: `${execError.stdout?.toString() ?? ""}${execError.stderr?.toString() ?? ""}`,
      dockerLog: existsSync(dockerLog) ? readFileSync(dockerLog, "utf8") : ""
    };
  }
}

function extractComposeServiceBlock(serviceName: string) {
  const compose = readFileSync(composePath, "utf8");
  const lines = compose.split("\n");
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (start === -1) {
    return "";
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-z0-9-]+:$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

beforeEach(() => {
  acquireRootEnvLock();
  rootEnvState = createRootEnvTestState(rootEnvPath);
});

afterEach(() => {
  restoreManagedRootEnv(rootEnvPath, rootEnvState);

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { force: true, recursive: true });
  }

  releaseRootEnvLock();
});

describe("release readiness files", () => {
  it("publishes and verifies the full main snapshot artifact set for rehearsal", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const mainSnapshotTagCount = (workflow.match(/type=sha,prefix=main-/g) ?? []).length;
    const playoutMetadata = workflow.indexOf("images: ghcr.io/drjakeberg/stream247-playout");
    const lastBuildPush = workflow.lastIndexOf("uses: docker/build-push-action@v6");
    const verifyStep = workflow.indexOf("name: Verify published main snapshot artifacts");

    expect(mainSnapshotTagCount).toBe(3);
    expect(playoutMetadata).toBeGreaterThan(-1);
    expect(verifyStep).toBeGreaterThan(lastBuildPush);
    expect(workflow).toContain('wait_for_manifest stream247-web "main-${SOURCE_SHA}"');
    expect(workflow).toContain('wait_for_manifest stream247-worker "main-${SOURCE_SHA}"');
    expect(workflow).toContain('wait_for_manifest stream247-playout "main-${SOURCE_SHA}"');
    expect(workflow).toContain(
      'echo "Published image ghcr.io/drjakeberg/${image}:${tag} was not registry-visible after push."'
    );
  });

  it("publishes the already-smoke-tested main snapshot images instead of rebuilding release tags", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");
    const sourceSha = workflow.indexOf('SOURCE_SHA="${GITHUB_SHA::7}"');
    const webCandidatePull = workflow.indexOf('docker pull "ghcr.io/drjakeberg/stream247-web:main-${SOURCE_SHA}"');
    const workerCandidatePull = workflow.indexOf('docker pull "ghcr.io/drjakeberg/stream247-worker:main-${SOURCE_SHA}"');
    const playoutCandidatePull = workflow.indexOf('docker pull "ghcr.io/drjakeberg/stream247-playout:main-${SOURCE_SHA}"');
    const webSmoke = workflow.indexOf("./docker/smoke-test.sh stream247-web:release-candidate");
    const composeSmoke = workflow.indexOf(
      "STREAM247_FRESH_COMPOSE_WEB_IMAGE=stream247-web:release-candidate STREAM247_FRESH_COMPOSE_WORKER_IMAGE=stream247-worker:release-candidate STREAM247_FRESH_COMPOSE_PLAYOUT_IMAGE=stream247-playout:release-candidate pnpm test:fresh-compose"
    );
    const webPublish = workflow.indexOf('source_image="stream247-web:release-candidate"');
    const workerPublish = workflow.indexOf('source_image="stream247-worker:release-candidate"');
    const playoutPublish = workflow.indexOf('source_image="stream247-playout:release-candidate"');
    const firstPush = workflow.indexOf('docker image push "$tag"');

    expect(sourceSha).toBeGreaterThan(-1);
    expect(webCandidatePull).toBeGreaterThan(sourceSha);
    expect(workerCandidatePull).toBeGreaterThan(webCandidatePull);
    expect(playoutCandidatePull).toBeGreaterThan(workerCandidatePull);
    expect(webSmoke).toBeGreaterThan(playoutCandidatePull);
    expect(composeSmoke).toBeGreaterThan(webSmoke);
    expect(webPublish).toBeGreaterThan(composeSmoke);
    expect(workerPublish).toBeGreaterThan(webPublish);
    expect(playoutPublish).toBeGreaterThan(workerPublish);
    expect(firstPush).toBeGreaterThan(composeSmoke);
    expect(workflow).not.toContain("docker/build-push-action@v6");
    expect(workflow).not.toContain("docker build -f docker/web.Dockerfile -t stream247-web:release-candidate .");
    expect(workflow).toContain('target_id="$(docker image inspect "$tag" --format \'{{.Id}}\')"');
  });

  it("adds restart policies to the always-on production services", () => {
    for (const serviceName of ["traefik", "web", "worker", "playout", "postgres", "redis"]) {
      expect(extractComposeServiceBlock(serviceName)).toContain("restart: unless-stopped");
    }
  });

  it("runs worker-family containers under an init process for child reaping", () => {
    const dockerfile = readFileSync(workerDockerfilePath, "utf8");

    expect(dockerfile).toContain("apk add --no-cache chromium ffmpeg yt-dlp python3 ttf-dejavu tini");
    expect(dockerfile).toContain('ENTRYPOINT ["/sbin/tini", "--"]');
  });

  it("gives worker-family healthchecks enough time under playout load", () => {
    expect(extractComposeServiceBlock("worker")).toContain("timeout: 30s");
    expect(extractComposeServiceBlock("playout")).toContain("timeout: 30s");
  });
});

describe("root env preservation helpers", () => {
  it("leaves an untouched pre-existing root env in place", () => {
    const tempDir = rememberTempDir("stream247-release-readiness-helper-");
    const envPath = path.join(tempDir, ".env");
    writeFileSync(envPath, "APP_URL=https://example.test\n");

    const state = createRootEnvTestState(envPath);
    restoreManagedRootEnv(envPath, state);

    expect(readFileSync(envPath, "utf8")).toBe("APP_URL=https://example.test\n");
  });

  it("restores the original root env after a test-managed replacement", () => {
    const tempDir = rememberTempDir("stream247-release-readiness-helper-");
    const envPath = path.join(tempDir, ".env");
    writeFileSync(envPath, "APP_URL=https://original.test\n");

    const state = createRootEnvTestState(envPath);
    writeManagedRootEnv(envPath, state, "APP_URL=https://test-double.test\n");
    expect(readFileSync(envPath, "utf8")).toBe("APP_URL=https://test-double.test\n");

    restoreManagedRootEnv(envPath, state);

    expect(readFileSync(envPath, "utf8")).toBe("APP_URL=https://original.test\n");
  });

  it("removes a test-created root env when none existed before", () => {
    const tempDir = rememberTempDir("stream247-release-readiness-helper-");
    const envPath = path.join(tempDir, ".env");

    const state = createRootEnvTestState(envPath);
    writeManagedRootEnv(envPath, state, "APP_URL=https://ephemeral.test\n");
    expect(existsSync(envPath)).toBe(true);

    restoreManagedRootEnv(envPath, state);

    expect(existsSync(envPath)).toBe(false);
  });
});

describe("release readiness scripts", () => {
  it("upgrade rehearsal uses the current main snapshot for unreleased target versions", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\nAPP_SECRET=test\nPOSTGRES_PASSWORD=test\nDATABASE_URL=postgresql://stream247:test@postgres:5432/stream247\n`);

    const sourceSha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8"
    }).trim();
    const readyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","destination":"ok"},"playout":{"selectionReasonCode":"scheduled","fallbackTier":"none","crashLoopDetected":false}}\n';
    const result = runShellScript(
      upgradeScriptPath,
      ["1.1.0"],
      [{ body: '{"status":"ok"}\n' }, { body: readyResponse }, { body: readyResponse }],
      {
        docker: {
          manifestAvailableRefs: []
        }
      }
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain(`Using rehearsal artifact source: pre-release main snapshot main-${sourceSha}`);
    expect(result.dockerLog).toContain(
      `ENV:STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:main-${sourceSha}`
    );
    expect(result.dockerLog).toContain(
      `ENV:STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:main-${sourceSha}`
    );
    expect(result.dockerLog).toContain(
      `ENV:STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:main-${sourceSha}`
    );
  });

  it("upgrade rehearsal uses the published release tag when it already exists", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\nAPP_SECRET=test\nPOSTGRES_PASSWORD=test\nDATABASE_URL=postgresql://stream247:test@postgres:5432/stream247\n`);

    const readyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","destination":"ok"},"playout":{"selectionReasonCode":"scheduled","fallbackTier":"none","crashLoopDetected":false}}\n';
    const result = runShellScript(
      upgradeScriptPath,
      ["1.0.3"],
      [{ body: '{"status":"ok"}\n' }, { body: readyResponse }, { body: readyResponse }],
      {
        docker: {
          manifestAvailableRefs: [
            "ghcr.io/drjakeberg/stream247-web:v1.0.3",
            "ghcr.io/drjakeberg/stream247-worker:v1.0.3",
            "ghcr.io/drjakeberg/stream247-playout:v1.0.3"
          ]
        }
      }
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain("Resolved release tag: v1.0.3");
    expect(result.output).toContain("Using rehearsal artifact source: published release tag v1.0.3");
    expect(result.dockerLog).toContain("ENV:STREAM247_WEB_IMAGE=ghcr.io/drjakeberg/stream247-web:v1.0.3");
    expect(result.dockerLog).toContain(
      "ENV:STREAM247_WORKER_IMAGE=ghcr.io/drjakeberg/stream247-worker:v1.0.3"
    );
    expect(result.dockerLog).toContain(
      "ENV:STREAM247_PLAYOUT_IMAGE=ghcr.io/drjakeberg/stream247-playout:v1.0.3"
    );
  });

  it("upgrade rehearsal fails until the channel is actually broadcast-ready", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\nAPP_SECRET=test\nPOSTGRES_PASSWORD=test\nDATABASE_URL=postgresql://stream247:test@postgres:5432/stream247\n`);

    const result = runShellScript(upgradeScriptPath, ["v1.0.3"], [
      { body: '{"status":"ok"}\n' },
      {
        body: '{"status":"ok","broadcastReady":false,"services":{"worker":"ok","playout":"ok","destination":"not-ready"},"playout":{"selectionReasonCode":"fallback","fallbackTier":"standby","crashLoopDetected":false}}\n'
      }
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("did not become broadcast-ready enough");
  });

  it("upgrade rehearsal succeeds when readiness is broadcast-ready", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\nAPP_SECRET=test\nPOSTGRES_PASSWORD=test\nDATABASE_URL=postgresql://stream247:test@postgres:5432/stream247\n`);

    const readyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","destination":"ok"},"playout":{"selectionReasonCode":"scheduled","fallbackTier":"none","crashLoopDetected":false}}\n';
    const result = runShellScript(upgradeScriptPath, ["v1.0.3"], [
      { body: '{"status":"ok"}\n' },
      { body: readyResponse },
      { body: readyResponse }
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("broadcastReady=true");
    expect(result.dockerLog).toContain("compose --env-file");
    expect(result.dockerLog).toContain("pull");
    expect(result.dockerLog).toContain("up -d");
  });

  it("soak monitor fails when broadcast readiness is false or destinations are not ready", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    const result = runShellScript(soakScriptPath, ["--hours", "24", "--interval-seconds", "0"], [
      {
        body: '{"status":"ok","broadcastReady":false,"services":{"worker":"ok","playout":"ok","destination":"not-ready"},"playout":{"status":"failed","selectionReasonCode":"fallback","fallbackTier":"standby","crashLoopDetected":false,"crashCountWindow":2,"restartCount":725,"lastExitCode":"SIGBUS","currentAssetId":"asset_current"}}\n'
      }
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("broadcastReady=false");
    expect(result.output).toContain("destination=not-ready");
    expect(result.output).toContain("playoutStatus=failed");
    expect(result.output).toContain("lastExitCode=SIGBUS");
    expect(result.output).toContain("restartCount=725");
    expect(result.output).toContain("crashCountWindow=2");
  });
});
