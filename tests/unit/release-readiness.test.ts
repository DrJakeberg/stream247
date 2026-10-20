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
  // One `State.StartedAt` per inspect, as for the restart counts; without a list a service never restarts.
  startedAt?: Record<string, string[]>;
  // One answer per inspect of web's networks: "project=<name> <network>=<address> …".
  webNetworks?: string[];
  // Services `docker compose ps -q` finds no running container for.
  missingServices?: string[];
  // From this second of the SOAK_CLOCK_FILE clock on, every docker call hangs (and is logged as "blocked: …"),
  // as a call does while a socket-activated dockerd is stopped or starting.
  blockFromEpoch?: number;
};

// The real sleep, for a stub that must hang: the test's own `sleep` stub on PATH returns at once.
const realSleep = ["/bin/sleep", "/usr/bin/sleep"].find((candidate) => existsSync(candidate)) ?? "sleep";

// A connection refused at that host from the given curl call on, up to untilCall if given (1-based, every
// call counts), as curl answers when nothing listens at the address.
type CurlRefusal = { host: string; fromCall: number; untilCall?: number };

// The two release test files share this lock, one test at a time, and each releases and takes it again
// between its own tests. Without a pause after the release the file that holds it can take it again
// before the other file's next 25-ms poll, and the other file waits out the whole run of the first:
// since M111 release-readiness runs about 30 s under the full suite, as long as the old 30-s deadline.
const ROOT_ENV_LOCK_WAIT_MS = 120_000;

function acquireRootEnvLock() {
  const deadline = Date.now() + ROOT_ENV_LOCK_WAIT_MS;

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
  // Hand the lock over: the other file polls every 25 ms.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
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
  const startedAtDir = path.join(tempDir, "started-at");
  const webNetworksPath = path.join(tempDir, "web-networks.txt");
  const missingServicesPath = path.join(tempDir, "missing-services.txt");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(restartCountsDir, { recursive: true });
  mkdirSync(startedAtDir, { recursive: true });
  writeFileSync(manifestRefsPath, `${(options.manifestAvailableRefs ?? []).join("\n")}\n`);
  for (const [service, counts] of Object.entries(options.restartCounts ?? {})) {
    writeFileSync(path.join(restartCountsDir, `${service}.txt`), `${counts.join("\n")}\n`);
  }
  for (const [service, starts] of Object.entries(options.startedAt ?? {})) {
    writeFileSync(path.join(startedAtDir, `${service}.txt`), `${starts.join("\n")}\n`);
  }
  writeFileSync(webNetworksPath, `${(options.webNetworks ?? ["project=stream247 stream247_default=172.30.0.2"]).join("\n")}\n`);
  writeFileSync(missingServicesPath, `${(options.missingServices ?? []).join("\n")}\n`);
  writeFileSync(
    path.join(binDir, "docker"),
    `#!/usr/bin/env sh
all_args="$*"
last_arg=""
for arg in "$@"; do
  last_arg="$arg"
done
if [ -n "${options.blockFromEpoch ?? ""}" ] && [ -n "\${SOAK_CLOCK_FILE:-}" ] && [ "$(cat "$SOAK_CLOCK_FILE")" -ge "${options.blockFromEpoch ?? 0}" ]; then
  printf 'blocked: %s\\n' "$all_args" >> "${dockerLog}"
  exec "${realSleep}" 30
fi
if [ "\${1:-}" = "manifest" ] && [ "\${2:-}" = "inspect" ]; then
  printf '%s\\n' "$all_args" >> "${dockerLog}"
  if grep -Fx "\${3:-}" "${manifestRefsPath}" >/dev/null 2>&1; then
    exit 0
  fi
  exit 1
fi

if [ "\${1:-}" = "compose" ] && [ "\${2:-}" = "ps" ]; then
  printf '%s\\n' "$all_args" >> "${dockerLog}"
  if grep -Fx "$last_arg" "${missingServicesPath}" >/dev/null 2>&1; then
    exit 0
  fi
  printf '%s-container\\n' "$last_arg"
  exit 0
fi

# Reads the next line of a per-call sequence file ($1), repeating its last line; $2 is the fallback.
next_in_sequence() {
  if [ ! -f "$1" ]; then
    printf '%s\\n' "$2"
    return 0
  fi
  index="$(cat "$1.index" 2>/dev/null || echo 0)"
  value="$(sed -n "$((index + 1))p" "$1")"
  if [ -z "$value" ]; then
    value="$(tail -n 1 "$1")"
  fi
  echo $((index + 1)) > "$1.index"
  printf '%s\\n' "$value"
}

if [ "\${1:-}" = "inspect" ] && printf '%s' "$all_args" | grep -q 'NetworkSettings'; then
  printf '%s\\n' "$all_args" >> "${dockerLog}"
  next_in_sequence "${webNetworksPath}" ""
  exit 0
fi

if [ "\${1:-}" = "inspect" ] && printf '%s' "$all_args" | grep -q 'StartedAt'; then
  printf '%s\\n' "$all_args" >> "${dockerLog}"
  next_in_sequence "${startedAtDir}/\${last_arg%-container}.txt" "2026-10-18T16:10:50.000000000Z"
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

function createCurlStub(binDir: string, tempDir: string, responses: CurlResponse[], refusals: CurlRefusal[] = []) {
  const responseDir = path.join(tempDir, "curl-responses");
  const counterFile = path.join(tempDir, "curl-count");
  const callsFile = path.join(tempDir, "curl-calls");
  const curlLog = path.join(tempDir, "curl.log");
  const refusalLines = refusals
    .map(
      (refusal) => `if [ "$call" -ge ${refusal.fromCall} ] && [ "$call" -le ${refusal.untilCall ?? 1_000_000} ] && printf '%s' "$all_args" | grep -qF -e '//${refusal.host}:' -e '//${refusal.host}/'; then
  printf "curl: (7) Failed to connect to %s port 3000 after 0 ms: Couldn't connect to server\\n" '${refusal.host}' >&2
  exit 7
fi`
    )
    .join("\n");
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
call=$(( $(cat "${callsFile}" 2>/dev/null || echo 0) + 1 ))
echo "$call" > "${callsFile}"
printf '%s\\n' "$all_args" >> "${curlLog}"
${refusalLines}
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
  options: {
    docker?: DockerStubOptions;
    env?: Record<string, string>;
    clockStartEpoch?: number;
    curlRefusals?: CurlRefusal[];
  } = {}
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
  createCurlStub(binDir, tempDir, responses, options.curlRefusals);
  const curlLog = path.join(tempDir, "curl.log");
  const readLog = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");

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
      dockerLog: readLog(dockerLog),
      curlLog: readLog(curlLog)
    };
  } catch (error) {
    const execError = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      status: execError.status ?? 1,
      output: `${execError.stdout?.toString() ?? ""}${execError.stderr?.toString() ?? ""}`,
      dockerLog: readLog(dockerLog),
      curlLog: readLog(curlLog)
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
}, ROOT_ENV_LOCK_WAIT_MS + 10_000);

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
    expect(result.output).toContain("Baseline container restarts: web=0 worker=0 playout=0 uplink=0 relay=0");
    expect(result.output).toContain("container-restart-check-failed webRestarts=2(+2)");
  });

  // M95 (U18): an uplink that crashed and came back between two samples, or a relay restart, passed a
  // 24 h soak because only web, worker and playout were counted.
  it("soak monitor fails on an uplink or relay container restart", () => {
    writeRootEnv(`APP_URL=http://127.0.0.1:3000\n`);

    const healthyResponse =
      '{"status":"ok","broadcastReady":true,"services":{"worker":"ok","playout":"ok","uplink":"ok","programFeed":"ok","destination":"ok"},"playout":{"status":"running","selectionReasonCode":"scheduled_match","fallbackTier":"scheduled","crashLoopDetected":false,"crashCountWindow":0,"restartCount":1,"lastExitCode":"","currentAssetId":"asset_current"},"uplink":{"status":"running","unplannedRestartCount":0},"programFeed":{"status":"fresh"}}\n';

    for (const service of ["uplink", "relay"]) {
      const result = runShellScript(
        soakScriptPath,
        ["--hours", "24", "--interval-seconds", "0"],
        [{ body: healthyResponse }, { body: healthyResponse }],
        { docker: { restartCounts: { web: [0, 0], worker: [0, 0], playout: [0, 0], [service]: [0, 1] } } }
      );

      expect(result.status, service).toBe(1);
      expect(result.output).toContain("Baseline container restarts: web=0 worker=0 playout=0 uplink=0 relay=0");
      expect(result.output).toContain(`container-restart-check-failed ${service}Restarts=1(+1)`);
    }
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

  // M111. On 2026-10-18 22:15 UTC an apt upgrade of containerd.io restarted the Docker daemon on the DUT.
  // Every container came back, the channel was on air again 16 s later, but not at the old addresses: web
  // went from .7 to .5 and .7 went to worker. A soak that kept asking .7 read "Failed to connect" for 6 min
  // and ended outage-exceeded; RestartCount stayed 0, so nothing in the log said what had happened.
  const FOLLOW_WEB = { CHECK_BASE_URL: "", COMPOSE_PROJECT_NAME: "stream247" };
  // The stack's own network listed second, so the pick is by project and not by docker's order.
  const webAt = (address: string) => `project=stream247 a_proxy=172.18.0.9 stream247_net=${address}`;
  const readinessRequests = (curlLog: string) => curlLog.split("\n").filter((line) => line.includes("/api/system/readiness"));
  const STARTED = "2026-10-18T16:10:50.000000000Z";
  const RESTARTED = "2026-10-18T22:15:15.000000000Z";
  const SERVICES = ["web", "worker", "playout", "uplink", "relay"];
  const everyServiceRestartsAtTheSecondSample = Object.fromEntries(
    // Baseline, first sample, then the new start time from the second sample on.
    SERVICES.map((service) => [service, [STARTED, STARTED, RESTARTED]])
  );

  it("soak monitor with --follow-web follows web to its new address: one changed line, no failed sample, no outage", () => {
    const result = runShellScript(
      soakScriptPath,
      ["--hours", "1", "--interval-seconds", "300", "--follow-web"],
      [healthy],
      {
        env: FOLLOW_WEB,
        clockStartEpoch: CLOCK,
        docker: { webNetworks: [webAt("172.22.0.7"), webAt("172.22.0.5")] },
        // The baseline fetch and the first sample reach .7; from the second sample on nothing listens there.
        curlRefusals: [{ host: "172.22.0.7", fromCall: 3 }]
      }
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain("Starting soak monitor for 1h at http://172.22.0.7:3000");
    expect(result.output).toContain("Following the web container: address=172.22.0.7 network=stream247_net");
    expect(result.output.match(/web-address-changed /g) ?? []).toHaveLength(1);
    expect(result.output).toContain("web-address-changed old=172.22.0.7 new=172.22.0.5 network=stream247_net");
    expect(result.output).not.toContain("fetch-failed");
    expect(result.output).not.toContain("outage-");
    expect(result.output).toContain(
      "soak-monitor-complete outages=0 outageSecondsMax=0 outageSecondsTotal=0 dockerRestarts=0 containersStartedAgain=0"
    );
    // Twelve samples: the baseline fetch, the first sample and one refused try at .7, then .5 only.
    const asked = readinessRequests(result.curlLog);
    expect(asked.filter((line) => line.includes("//172.22.0.7:"))).toHaveLength(3);
    expect(asked.filter((line) => line.includes("//172.22.0.5:"))).toHaveLength(11);
  }, 30_000);

  it("soak monitor with an explicit public CHECK_BASE_URL never looks web up and counts a refused connection as before", () => {
    const result = runShellScript(soakScriptPath, ["--hours", "1", "--interval-seconds", "300"], [healthy], {
      env: { CHECK_BASE_URL: "https://stream.example.com" },
      clockStartEpoch: CLOCK,
      curlRefusals: [{ host: "stream.example.com", fromCall: 3, untilCall: 3 }]
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain("Starting soak monitor for 1h at https://stream.example.com");
    expect(result.output).toContain(
      "readiness-fetch-failed-tolerated 1/2 fetch-failed: curl: (7) Failed to connect to stream.example.com port 3000"
    );
    expect(result.output).toContain("outage-recovered duration=300s samples=1 tolerance=300s");
    expect(result.output).not.toContain("Following the web container");
    expect(result.output).not.toContain("web-address");
    expect(result.dockerLog).not.toContain("NetworkSettings");
    const asked = readinessRequests(result.curlLog);
    expect(asked).toHaveLength(13);
    expect(asked.every((line) => line.includes("https://stream.example.com/api/system/readiness"))).toBe(true);
    expect(result.output).toContain(
      "soak-monitor-complete outages=1 outageSecondsMax=300 outageSecondsTotal=300 dockerRestarts=0 containersStartedAgain=0"
    );
  }, 30_000);

  it("soak monitor with --follow-web stops with a clear message when there is no web container to follow", () => {
    const missing = runShellScript(soakScriptPath, ["--hours", "1", "--follow-web"], [healthy], {
      env: FOLLOW_WEB,
      docker: { missingServices: ["web"] }
    });
    expect(missing.status).toBe(1);
    expect(missing.output).toContain(
      "Cannot follow the web container: no running web container (docker compose ps -q web is empty here, COMPOSE_PROJECT_NAME=stream247)."
    );
    expect(missing.output).not.toContain("Starting soak monitor");
    expect(missing.curlLog).toBe("");

    const noAddress = runShellScript(soakScriptPath, ["--hours", "1", "--follow-web"], [healthy], {
      env: FOLLOW_WEB,
      docker: { webNetworks: ["project=stream247 stream247_net="] }
    });
    expect(noAddress.status).toBe(1);
    expect(noAddress.output).toContain("Cannot follow the web container: web container web-container has no address on any network.");

    const both = runShellScript(soakScriptPath, ["--hours", "1", "--follow-web"], [healthy], {
      env: { CHECK_BASE_URL: "http://172.22.0.7:3000" }
    });
    expect(both.status).toBe(1);
    expect(both.output).toContain("--follow-web measures the web container's own address: unset CHECK_BASE_URL or drop --follow-web.");
    expect(both.curlLog).toBe("");
  });

  it("soak monitor with --follow-web counts the sample as failed while web has no address yet, and follows it at the next one", () => {
    const result = runShellScript(
      soakScriptPath,
      ["--hours", "1", "--interval-seconds", "300", "--follow-web"],
      [healthy],
      {
        env: FOLLOW_WEB,
        clockStartEpoch: CLOCK,
        // At the first refused sample web is not running again yet; at the next it is, at .5.
        docker: { webNetworks: [webAt("172.22.0.7"), "project=stream247 stream247_net=", webAt("172.22.0.5")] },
        curlRefusals: [{ host: "172.22.0.7", fromCall: 3 }]
      }
    );

    expect(result.status).toBe(0);
    expect(result.output).toMatch(
      /readiness-fetch-failed-tolerated 1\/2 fetch-failed: curl: \(7\) Failed to connect to 172\.22\.0\.7 [^\n]* web-address-lookup-failed: web container web-container has no address on any network/
    );
    expect(result.output.match(/web-address-changed /g) ?? []).toHaveLength(1);
    expect(result.output).toContain("web-address-changed old=172.22.0.7 new=172.22.0.5 network=stream247_net");
    expect(result.output).toContain("outage-recovered duration=300s samples=1 tolerance=300s");
    expect(result.output).toContain("soak-monitor-complete outages=1 outageSecondsMax=300 outageSecondsTotal=300");
  }, 30_000);

  it("soak monitor logs a Docker daemon restart that RestartCount does not show, and names it in the completion line", () => {
    const result = runShellScript(soakScriptPath, ["--hours", "1", "--interval-seconds", "300"], [healthy], {
      clockStartEpoch: CLOCK,
      docker: { startedAt: everyServiceRestartsAtTheSecondSample }
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain("Baseline container restarts: web=0 worker=0 playout=0 uplink=0 relay=0");
    expect(result.output).toContain(`Baseline container starts: ${SERVICES.map((service) => `${service}=${STARTED}`).join(" ")}`);
    // Once, at the second sample, with the time the containers started again; RestartCount stayed 0.
    expect(result.output.match(/docker-daemon-restart /g) ?? []).toHaveLength(1);
    expect(result.output).toMatch(
      new RegExp(`T[0-9:+-]+ docker-daemon-restart startedAt=${RESTARTED} services=web,worker,playout,uplink,relay\\n`)
    );
    expect(result.output).not.toContain("container-restart-check-failed");
    expect(result.output).not.toContain("container-started-again");
    // The outage rules are unchanged: no bad sample, no outage; but the pass does not read like a clean one.
    expect(result.output).toContain(
      "soak-monitor-complete outages=0 outageSecondsMax=0 outageSecondsTotal=0 dockerRestarts=1 containersStartedAgain=0"
    );
  }, 30_000);

  it("soak monitor logs a single container started again outside its restart policy and counts it", () => {
    const result = runShellScript(soakScriptPath, ["--hours", "1", "--interval-seconds", "300"], [healthy], {
      clockStartEpoch: CLOCK,
      docker: { startedAt: { worker: [STARTED, STARTED, RESTARTED] } }
    });

    expect(result.status).toBe(0);
    expect(result.output.match(/container-started-again /g) ?? []).toHaveLength(1);
    expect(result.output).toContain(`container-started-again startedAt=${RESTARTED} services=worker`);
    expect(result.output).not.toContain("docker-daemon-restart");
    expect(result.output).toContain("dockerRestarts=0 containersStartedAgain=1");
  }, 30_000);

  it("soak monitor with --follow-web carries the Docker restart of 2026-10-18 without an outage and reports it", () => {
    const result = runShellScript(
      soakScriptPath,
      ["--hours", "1", "--interval-seconds", "300", "--follow-web"],
      [healthy],
      {
        env: FOLLOW_WEB,
        clockStartEpoch: CLOCK,
        docker: { startedAt: everyServiceRestartsAtTheSecondSample, webNetworks: [webAt("172.22.0.7"), webAt("172.22.0.5")] },
        curlRefusals: [{ host: "172.22.0.7", fromCall: 3 }]
      }
    );

    expect(result.status).toBe(0);
    // The log says why the address moved: the change, then, after the healthy sample at the new address, the
    // restart that moved it (the start times are read only after a healthy sample), then the sample itself.
    expect(result.output).toMatch(
      /web-address-changed old=172\.22\.0\.7 new=172\.22\.0\.5[^\n]*\n[^\n]*docker-daemon-restart startedAt=[^\n]*\n[^\n]*status=ok /
    );
    expect(result.output).not.toContain("fetch-failed");
    expect(result.output).not.toContain("outage-exceeded");
    expect(result.output).toContain(
      "soak-monitor-complete outages=0 outageSecondsMax=0 outageSecondsTotal=0 dockerRestarts=1 containersStartedAgain=0"
    );
  }, 30_000);

  // A socket-activated dockerd that is stopped or starting leaves docker calls hanging. The off-air time must
  // still reach the outage window: the failure path asks docker nothing but the bounded lookup.
  // A fraction of a second (GNU timeout takes one): each blocked call costs the test that much, and these tests
  // hold the root-env lock that tests/unit/release-preflight.test.ts waits at most 30 s for.
  const DOCKER_HANGS = { SOAK_DOCKER_TIMEOUT_SECONDS: "0.2" };
  const blockedCalls = (dockerLog: string) => dockerLog.split("\n").filter((line) => line.startsWith("blocked: "));

  it("soak monitor with --follow-web keeps sampling while docker does not answer and ends outage-exceeded past the window", () => {
    const result = runShellScript(
      soakScriptPath,
      ["--hours", "1", "--interval-seconds", "60", "--follow-web"],
      [healthy],
      {
        env: { ...FOLLOW_WEB, ...DOCKER_HANGS },
        clockStartEpoch: CLOCK,
        // dockerd goes away after the first sample, and web with it.
        docker: { webNetworks: [webAt("172.22.0.7")], blockFromEpoch: CLOCK + 1 },
        curlRefusals: [{ host: "172.22.0.7", fromCall: 3 }]
      }
    );

    expect(result.status).toBe(1);
    expect(result.output).toMatch(
      /readiness-fetch-failed-tolerated 1\/2 fetch-failed: curl: \(7\) Failed to connect to 172\.22\.0\.7 [^\n]* web-address-lookup-failed: docker did not answer within 0.2s \(docker compose ps -q web\)/
    );
    // Bad samples at 60 … 420 s; the one at 420 s is 360 s into the outage, past the 300 s window.
    expect(result.output).toMatch(/outage-exceeded elapsed=360s tolerance=300s samples=7 fetch-failed /);
    expect(result.output).not.toContain("soak-monitor-complete");
    // One lookup per refused sample, then the closing read of the five start times; none of them held a sample.
    expect(blockedCalls(result.dockerLog)).toHaveLength(7 + 5);
  }, 60_000);

  it("soak monitor with an explicit CHECK_BASE_URL asks docker nothing while an outage runs, so a hanging docker cannot hide it", () => {
    const result = runShellScript(soakScriptPath, ["--hours", "1", "--interval-seconds", "60"], [healthy], {
      env: DOCKER_HANGS,
      clockStartEpoch: CLOCK,
      docker: { blockFromEpoch: CLOCK + 1 },
      curlRefusals: [{ host: "127.0.0.1", fromCall: 3 }]
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain("Starting soak monitor for 1h at http://127.0.0.1:3000");
    expect(result.output).toMatch(/outage-exceeded elapsed=360s tolerance=300s samples=7 fetch-failed /);
    expect(result.output).not.toContain("web-address");
    // Only the closing read of the start times, after the verdict.
    expect(blockedCalls(result.dockerLog)).toHaveLength(5);
    expect(blockedCalls(result.dockerLog).every((line) => line.includes("compose ps -q"))).toBe(true);
  }, 60_000);

  it("soak monitor names a Docker daemon restart in the log of a soak that an outage ended", () => {
    // 2026-10-18 as it ran: the old address in CHECK_BASE_URL, refused from the second sample on. Start times:
    // baseline, first sample, then the closing read after the verdict.
    const result = runShellScript(soakScriptPath, ["--hours", "1", "--interval-seconds", "60"], [healthy], {
      env: { CHECK_BASE_URL: "http://172.22.0.7:3000" },
      clockStartEpoch: CLOCK,
      docker: { startedAt: everyServiceRestartsAtTheSecondSample },
      curlRefusals: [{ host: "172.22.0.7", fromCall: 3 }]
    });

    expect(result.status).toBe(1);
    expect(result.output).toMatch(
      new RegExp(
        `docker-daemon-restart startedAt=${RESTARTED} services=web,worker,playout,uplink,relay\\n[^\\n]*outage-exceeded elapsed=360s`
      )
    );
    expect(result.output.match(/docker-daemon-restart /g) ?? []).toHaveLength(1);
  }, 30_000);
});
