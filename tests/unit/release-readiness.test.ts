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
// The per-sample rules as they stood before the outage window: these tests pin exactly those rules,
// and SOAK_OUTAGE_TOLERANCE_SECONDS=0 must keep reproducing them.
const STRICT_SOAK = { env: { SOAK_OUTAGE_TOLERANCE_SECONDS: "0" } };
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
  restartCounts?: Partial<Record<"web" | "worker" | "playout", number[]>>;
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
  const restartCountsDir = path.join(tempDir, "restart-counts");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(restartCountsDir, { recursive: true });
  writeFileSync(manifestRefsPath, `${(options.manifestAvailableRefs ?? []).join("\n")}\n`);
  for (const [service, counts] of Object.entries(options.restartCounts ?? {})) {
    writeFileSync(path.join(restartCountsDir, `${service}.txt`), `${counts.join("\n")}\n`);
  }
  writeFileSync(
    path.join(binDir, "docker"),
    `#!/usr/bin/env sh
all_args="$*"
last_arg=""
for arg in "$@"; do
  last_arg="$arg"
done
if [ "\${1:-}" = "manifest" ] && [ "\${2:-}" = "inspect" ]; then
  printf '%s\\n' "$all_args" >> "${dockerLog}"
  if grep -Fx "\${3:-}" "${manifestRefsPath}" >/dev/null 2>&1; then
    exit 0
  fi
  exit 1
fi

if [ "\${1:-}" = "compose" ] && [ "\${2:-}" = "ps" ]; then
  printf '%s\\n' "$all_args" >> "${dockerLog}"
  printf '%s-container\\n' "$last_arg"
  exit 0
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

if [ "\${1:-}" = "inspect" ]; then
  printf '%s\\n' "$all_args" >> "${dockerLog}"
  service="\${last_arg%-container}"
  sequence_file="${restartCountsDir}/\${service}.txt"
  index_file="${restartCountsDir}/\${service}.index"
  if [ ! -f "$sequence_file" ]; then
    printf '0\\n'
    exit 0
  fi
  index="$(cat "$index_file" 2>/dev/null || echo 0)"
  line_number=$((index + 1))
  value="$(sed -n "\${line_number}p" "$sequence_file")"
  if [ -z "$value" ]; then
    value="$(tail -n 1 "$sequence_file")"
  fi
  echo $((index + 1)) > "$index_file"
  printf '%s\\n' "$value"
  exit 0
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
all_args="$*"
if printf '%s\\n' "$all_args" | grep -q '/api/setup/bootstrap'; then
  output_file=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "-o" ] && [ "$#" -ge 2 ]; then
      output_file="$2"
      shift 2
      continue
    fi
    shift
  done
  if [ -n "$output_file" ]; then
    printf '{"ok":true}\\n' > "$output_file"
  fi
  printf '200'
  exit 0
fi
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

// A clock the soak monitor reads through SOAK_CLOCK_FILE; the stubbed sleep advances it by its argument.
// Without it, every sample happens in the same real second and a five-minute outage window can never close.
function createClockedSleepStub(binDir: string, clockFile: string, startEpoch: number) {
  writeFileSync(clockFile, `${startEpoch}\n`);
  writeFileSync(
    path.join(binDir, "sleep"),
    `#!/usr/bin/env sh
now="$(cat "${clockFile}")"
echo $((now + \${1:-0})) > "${clockFile}"
exit 0
`
  );
  chmodSync(path.join(binDir, "sleep"), 0o755);
}

function runShellScript(
  scriptPath: string,
  args: string[],
  responses: CurlResponse[],
  options: { docker?: DockerStubOptions; env?: Record<string, string>; clockStartEpoch?: number } = {}
) {
  const tempDir = rememberTempDir("stream247-release-readiness-script-");
  const { binDir, dockerLog } = createDockerStub(tempDir, options.docker);
  createSleepStub(binDir);
  const clockEnv: Record<string, string> = {};
  if (options.clockStartEpoch !== undefined) {
    const clockFile = path.join(tempDir, "clock");
    createClockedSleepStub(binDir, clockFile, options.clockStartEpoch);
    clockEnv.SOAK_CLOCK_FILE = clockFile;
  }
  createCurlStub(binDir, tempDir, responses);

  try {
    const output = execFileSync("sh", [scriptPath, ...args], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        CHECK_BASE_URL: "http://127.0.0.1:3000",
        UPGRADE_REHEARSAL_SEED_LOCAL_MEDIA: "0",
        ...clockEnv,
        ...options.env,
        PATH: `${binDir}:${process.env.PATH}`
      },
      stdio: ["ignore", "pipe", "pipe"],
      // A monitor that never reaches a verdict must fail the test, not hold it for a 24 h soak window.
      timeout: 60_000
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
}, 30_000);

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
    // The snapshots are pulled through wait_for_image, which retries until the CI run for this
    // commit has published them; a plain docker pull raced CI and failed the v1.5.18 release.
    const sourceSha = workflow.indexOf('SOURCE_SHA="${GITHUB_SHA::7}"');
    const webCandidatePull = workflow.indexOf('wait_for_image "ghcr.io/drjakeberg/stream247-web:main-${SOURCE_SHA}"');
    const workerCandidatePull = workflow.indexOf('wait_for_image "ghcr.io/drjakeberg/stream247-worker:main-${SOURCE_SHA}"');
    const playoutCandidatePull = workflow.indexOf('wait_for_image "ghcr.io/drjakeberg/stream247-playout:main-${SOURCE_SHA}"');
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
    for (const serviceName of ["traefik", "web", "worker", "relay", "playout", "uplink", "postgres"]) {
      expect(extractComposeServiceBlock(serviceName)).toContain("restart: unless-stopped");
    }
  });

  it("runs worker-family containers under an init process for child reaping", () => {
    const dockerfile = readFileSync(workerDockerfilePath, "utf8");

    expect(dockerfile).toContain("apk add --no-cache ffmpeg yt-dlp python3 ttf-dejavu tini");
    expect(dockerfile).toContain('ENTRYPOINT ["/sbin/tini", "--"]');
  });

  it("ships no browser in the worker-family image", () => {
    // The on-air overlay is rendered natively in-process. A browser in this image would only mean
    // the per-frame screenshot path had come back, which never worked in production and cost 10s
    // on every playout start.
    const dockerfile = readFileSync(workerDockerfilePath, "utf8");

    expect(dockerfile).not.toMatch(/\bchromium\b/);
  });

  it("gives worker-family healthchecks enough time under playout load", () => {
    for (const serviceName of ["worker", "playout", "uplink"]) {
      const serviceBlock = extractComposeServiceBlock(serviceName);
      expect(serviceBlock).toContain("interval: 45s");
      expect(serviceBlock).toContain("timeout: 45s");
      expect(serviceBlock).toContain("start_period: 60s");
    }
  });

  it("mounts media storage into uplink so it can read the HLS program feed", () => {
    expect(extractComposeServiceBlock("uplink")).toContain("./data/media:/app/data/media");
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
  }, 30_000);

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

  it("upgrade rehearsal tolerates empty startup responses before readiness becomes valid json", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\nAPP_SECRET=test\nPOSTGRES_PASSWORD=test\nDATABASE_URL=postgresql://stream247:test@postgres:5432/stream247\n`);

    const readyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","destination":"ok"},"playout":{"selectionReasonCode":"scheduled","fallbackTier":"none","crashLoopDetected":false}}\n';
    const result = runShellScript(upgradeScriptPath, ["v1.0.3"], [
      { body: "", status: 0 },
      { body: '{"status":"ok"}\n' },
      { body: "", status: 0 },
      { body: readyResponse },
      { body: readyResponse }
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("Upgrade rehearsal completed for v1.0.3.");
  });

  it("soak monitor fails immediately when broadcastReady=false (destination not-ready is included in fail line for forensics)", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    const result = runShellScript(soakScriptPath, ["--hours", "24", "--interval-seconds", "0"], [
      {
        body: '{"status":"ok","broadcastReady":false,"services":{"worker":"ok","playout":"ok","destination":"not-ready"},"playout":{"status":"failed","selectionReasonCode":"fallback","fallbackTier":"standby","crashLoopDetected":false,"crashCountWindow":2,"restartCount":725,"lastExitCode":"SIGBUS","currentAssetId":"asset_current"}}\n'
      }
    ], STRICT_SOAK);

    expect(result.status).toBe(1);
    expect(result.output).toContain("broadcastReady=false");
    // destination=not-ready is a transient candidate; included in the fail line for forensics
    // alongside the fatal broadcastReady=false.
    expect(result.output).toContain("destination=not-ready");
    expect(result.output).toContain("playoutStatus=failed");
    expect(result.output).toContain("lastExitCode=SIGBUS");
    expect(result.output).toContain("restartCount=725");
    expect(result.output).toContain("crashCountWindow=2");
  });

  it("soak monitor tolerates short local playout transients AND a clean-handoff uplink restart while broadcastReady stays true and feed stays fresh", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    const healthyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":4,"lastExitCode":"","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":0},"programFeed":{"status":"fresh"}}\n';
    const transientResponse =
      '{"status":"degraded","broadcastReady":false,"services":{"worker":"ok","playout":"not-ready","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"failed","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":1,"restartCount":5,"lastExitCode":"128","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":0},"programFeed":{"status":"fresh"}}\n';
    const restartedResponse =
      '{"status":"degraded","broadcastReady":true,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":6,"lastExitCode":"","currentAssetId":"asset_next"},"uplink":{"status":"running","unplannedRestartCount":1},"programFeed":{"status":"fresh"}}\n';
    // Final mock is a genuine immediate-fail so the test terminates after the warning-only
    // samples are processed.
    const finalFailResponse =
      '{"status":"degraded","broadcastReady":false,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"degraded","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":6,"lastExitCode":"","currentAssetId":"asset_next"},"uplink":{"status":"running","unplannedRestartCount":1},"programFeed":{"status":"stale"}}\n';

    const result = runShellScript(soakScriptPath, ["--hours", "24", "--interval-seconds", "0"], [
      { body: healthyResponse },
      { body: transientResponse },
      { body: restartedResponse },
      { body: finalFailResponse }
    ], STRICT_SOAK);

    // First three samples must be tolerated. Only the 4th (bReady=false + stale feed)
    // is a real fail. Exactly one readiness-check-failed should appear in the log.
    expect(result.status).toBe(1);
    expect(result.output).toContain("playoutTransient=true");
    expect(result.output).toContain("playout=not-ready");
    expect(result.output).toContain("lastExitCode=128");
    expect(result.output).toContain("uplinkUnplannedRestartsDelta=1");
    const failures = (result.output.match(/readiness-check-failed/g) ?? []).length;
    expect(failures).toBe(1);
    expect(result.output).toMatch(/readiness-check-failed [^\n]*broadcastReady=false/);
    expect(result.output).toMatch(/readiness-check-failed [^\n]*programFeed=stale/);
  });

  it("soak monitor tolerates a single uplink restart as a warning when broadcastReady=true and programFeed=fresh", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    const healthyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":1,"lastExitCode":"","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":0},"programFeed":{"status":"fresh"}}\n';
    const restartedResponse =
      '{"status":"degraded","broadcastReady":true,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":1,"lastExitCode":"","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":1},"programFeed":{"status":"fresh"}}\n';
    // Terminate the loop with a genuine fail-now sample so the test exits cleanly after the
    // warning sample is observed.
    const finalFailResponse =
      '{"status":"degraded","broadcastReady":false,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"degraded","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":1,"lastExitCode":"","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":1},"programFeed":{"status":"stale"}}\n';

    const result = runShellScript(soakScriptPath, ["--hours", "24", "--interval-seconds", "0"], [
      { body: healthyResponse },
      { body: restartedResponse },
      { body: finalFailResponse }
    ], STRICT_SOAK);

    expect(result.status).toBe(1);
    expect(result.output).toContain("uplinkUnplannedRestartsDelta=1");
    expect(result.output).toContain("uplinkStatus=running");
    // Exactly one readiness-check-failed (the terminal bReady=false sample). The middle
    // sample (the +1 uplink restart while healthy) must NOT have produced one.
    const failures = (result.output.match(/readiness-check-failed/g) ?? []).length;
    expect(failures).toBe(1);
    // The terminal failure must be due to bReady=false / stale feed, not the uplink delta alone.
    expect(result.output).toMatch(/readiness-check-failed [^\n]*broadcastReady=false/);
  });

  it("soak monitor fails on uplink restart runaway above SOAK_UPLINK_RESTART_RUNAWAY_DELTA", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    // Override the runaway threshold to 2 so the second mock (delta=3) trips it.
    const healthyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":1,"lastExitCode":"","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":0},"programFeed":{"status":"fresh"}}\n';
    const runawayResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":1,"lastExitCode":"","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":3},"programFeed":{"status":"fresh"}}\n';

    const result = runShellScript(
      soakScriptPath,
      ["--hours", "24", "--interval-seconds", "0"],
      [{ body: healthyResponse }, { body: runawayResponse }],
      { env: { SOAK_UPLINK_RESTART_RUNAWAY_DELTA: "2" } }
    );

    expect(result.status).toBe(1);
    expect(result.output).toMatch(/readiness-check-failed[^\n]*uplinkUnplannedRestarts=3\(delta=3\)/);
  });

  it("soak monitor tolerates ONE programFeed=stale sample during active playoutTransient, fails on the SECOND consecutive", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    // Mirrors the CLEAN3 03:36 → 03:37 sequence. First sample healthy. Second sample is a
    // playoutTransientStaleFeed (playout failed + feed stale + rest healthy) — tolerated.
    // Third sample is another playoutTransientStaleFeed — exceeds tolerance, fails.
    const healthyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":5671,"lastExitCode":"","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":413},"programFeed":{"status":"fresh"}}\n';
    const staleDuringTransient =
      '{"status":"degraded","broadcastReady":false,"services":{"worker":"ok","playout":"not-ready","uplink":"ok","programFeed":"degraded","destination":"ok"},"playout":{"status":"failed","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":5672,"lastExitCode":"SIGBUS","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":414},"programFeed":{"status":"stale"}}\n';

    const result = runShellScript(
      soakScriptPath,
      ["--hours", "24", "--interval-seconds", "0"],
      [
        { body: healthyResponse },
        { body: staleDuringTransient },
        { body: staleDuringTransient }
      ],
      STRICT_SOAK
    );

    // The first stale-during-transient sample must be tolerated (transient-tolerated line).
    expect(result.output).toMatch(/readiness-transient-tolerated[^\n]*playoutTransientStaleFeed=true/);
    // The second consecutive stale-during-transient sample must escalate to fatal.
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/readiness-check-failed-consecutive[^\n]*playoutTransientStaleFeed\(consecutive=2\)/);
  });

  it("soak monitor reports container restart counts and fails after repeated restarts", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    const healthyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":1,"lastExitCode":"","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":0},"programFeed":{"status":"fresh"}}\n';

    const result = runShellScript(
      soakScriptPath,
      ["--hours", "24", "--interval-seconds", "0"],
      [{ body: healthyResponse }, { body: healthyResponse }],
      {
        docker: {
          restartCounts: {
            web: [0, 2],
            worker: [0, 0],
            playout: [0, 0]
          }
        }
      }
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain("Baseline container restarts: web=0 worker=0 playout=0");
    expect(result.output).toContain("container-restart-check-failed webRestarts=2(+2)");
  });

  // The outage window, driven by a clock that advances 60 s per sample. The shapes are the samples that
  // ended the second 24 h soak on v2.0.0 at 2026-09-10 23:34 UTC: a failed fetch, then broadcast not ready
  // with the destination degraded and two unplanned uplink restarts — healed without any hand.
  const BLIP_BASELINE = 3895;
  const readinessBody = (opts: { broadcastReady?: boolean; destination?: string; unplanned?: number; crashLoop?: boolean } = {}) =>
    `${JSON.stringify({
      status: "ok",
      broadcastReady: opts.broadcastReady ?? true,
      services: { worker: "ok", playout: "ok", uplink: "ok", programFeed: "ok", destination: opts.destination ?? "ok" },
      playout: {
        status: "running",
        selectionReasonCode: "scheduled_match",
        fallbackTier: "scheduled",
        crashLoopDetected: opts.crashLoop ?? false,
        crashCountWindow: 0,
        restartCount: 8264,
        lastExitCode: "",
        currentAssetId: "asset_current"
      },
      uplink: { status: "running", unplannedRestartCount: opts.unplanned ?? BLIP_BASELINE },
      programFeed: { status: "fresh" }
    })}\n`;
  const healthy = { body: readinessBody() };
  const healedAfterBlip = { body: readinessBody({ unplanned: BLIP_BASELINE + 2 }) };
  const blip = { body: readinessBody({ broadcastReady: false, destination: "degraded", unplanned: BLIP_BASELINE + 2 }) };
  const fetch522 = { body: "curl: (22) The requested URL returned error: 522\n", status: 22 };
  const CLOCK = 1_000_000;

  it("soak monitor carries the nightly blip through the outage window, logs its recovery and completes", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    // First response is the baseline fetch; samples follow at 60 s steps on the fake clock.
    const result = runShellScript(
      soakScriptPath,
      ["--hours", "1", "--interval-seconds", "60"],
      [healthy, healthy, fetch522, blip, blip, healedAfterBlip],
      { clockStartEpoch: CLOCK }
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain("readiness-fetch-failed-tolerated 1/2");
    expect(result.output).toMatch(/outage-tolerated elapsed=60s\/300s[^\n]*broadcastReady=false/);
    expect(result.output).toMatch(/outage-tolerated elapsed=120s\/300s/);
    expect(result.output).toContain("outage-recovered duration=180s samples=3 tolerance=300s");
    expect(result.output).not.toContain("readiness-check-failed");
    // A pass with an outage must never read like a clean one.
    expect(result.output).toContain("soak-monitor-complete outages=1 outageSecondsMax=180 outageSecondsTotal=180");
  }, 30_000);

  it("soak monitor fails once an outage outlasts five minutes", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    const result = runShellScript(
      soakScriptPath,
      ["--hours", "1", "--interval-seconds", "60"],
      [healthy, healthy, blip],
      { clockStartEpoch: CLOCK }
    );

    expect(result.status).toBe(1);
    // Bad samples at 0, 60, 120, 180, 240 and 300 s are carried; the one at 360 s is not.
    expect((result.output.match(/outage-tolerated /g) ?? []).length).toBe(6);
    expect(result.output).toContain("outage-tolerated elapsed=300s/300s");
    expect(result.output).toMatch(/outage-exceeded elapsed=360s tolerance=300s samples=7 [^\n]*broadcastReady=false/);
    expect(result.output).not.toContain("soak-monitor-complete");
  });

  it("soak monitor never carries a crash loop, even with the outage window open", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    const crashLoop = { body: readinessBody({ crashLoop: true }) };
    const result = runShellScript(
      soakScriptPath,
      ["--hours", "1", "--interval-seconds", "60"],
      [healthy, healthy, blip, crashLoop],
      { clockStartEpoch: CLOCK }
    );

    expect(result.status).toBe(1);
    expect((result.output.match(/outage-tolerated /g) ?? []).length).toBe(1);
    expect(result.output).toMatch(/readiness-check-failed [^\n]*hard=playout\.crashLoopDetected=true/);
    expect(result.output).not.toContain("outage-exceeded");
  });

  it("soak monitor follows an outage still open at the end of the window to its outcome instead of passing mid-outage", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    // Sixty samples fill the hour (0 … 3540 s). The last of them is bad, so the window ends inside an
    // outage; the monitor must take one more sample and only then complete.
    const responses = [healthy, ...Array.from({ length: 59 }, () => healthy), blip, healedAfterBlip];
    const result = runShellScript(soakScriptPath, ["--hours", "1", "--interval-seconds", "60"], responses, {
      clockStartEpoch: CLOCK
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain("outage-tolerated elapsed=0s/300s");
    expect(result.output).toContain("outage-recovered duration=60s samples=1 tolerance=300s");
    expect(result.output).toContain("soak-monitor-complete outages=1 outageSecondsMax=60 outageSecondsTotal=60");
  }, 30_000);
});
