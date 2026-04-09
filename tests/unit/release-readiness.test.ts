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
const releaseWorkflowPath = path.join(rootDir, ".github", "workflows", "release.yml");
const composePath = path.join(rootDir, "docker-compose.yml");
const upgradeScriptPath = path.join(rootDir, "scripts", "upgrade-rehearsal.sh");
const soakScriptPath = path.join(rootDir, "scripts", "soak-monitor.sh");
const tempDirs: string[] = [];

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

function runShellScript(scriptPath: string, args: string[], responses: CurlResponse[]) {
  const tempDir = rememberTempDir("stream247-release-readiness-script-");
  const { binDir, dockerLog } = createDockerStub(tempDir);
  createSleepStub(binDir);
  createCurlStub(binDir, tempDir, responses);

  try {
    const output = execFileSync("sh", [scriptPath, ...args], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        CHECK_BASE_URL: "http://127.0.0.1:3000",
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
  rootEnvState = createRootEnvTestState(rootEnvPath);
});

afterEach(() => {
  restoreManagedRootEnv(rootEnvPath, rootEnvState);

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { force: true, recursive: true });
  }
});

describe("release readiness files", () => {
  it("publishes the already-smoke-tested candidate images instead of rebuilding release tags", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");
    const webCandidateBuild = workflow.indexOf("docker build -f docker/web.Dockerfile -t stream247-web:release-candidate .");
    const workerCandidateBuild = workflow.indexOf("docker build -f docker/worker.Dockerfile -t stream247-worker:release-candidate .");
    const playoutCandidateBuild = workflow.indexOf("docker build -f docker/worker.Dockerfile -t stream247-playout:release-candidate .");
    const webSmoke = workflow.indexOf("./docker/smoke-test.sh stream247-web:release-candidate");
    const composeSmoke = workflow.indexOf(
      "STREAM247_FRESH_COMPOSE_WEB_IMAGE=stream247-web:release-candidate STREAM247_FRESH_COMPOSE_WORKER_IMAGE=stream247-worker:release-candidate STREAM247_FRESH_COMPOSE_PLAYOUT_IMAGE=stream247-playout:release-candidate pnpm test:fresh-compose"
    );
    const webPublish = workflow.indexOf('source_image="stream247-web:release-candidate"');
    const workerPublish = workflow.indexOf('source_image="stream247-worker:release-candidate"');
    const playoutPublish = workflow.indexOf('source_image="stream247-playout:release-candidate"');
    const firstPush = workflow.indexOf('docker image push "$tag"');

    expect(webCandidateBuild).toBeGreaterThan(-1);
    expect(workerCandidateBuild).toBeGreaterThan(webCandidateBuild);
    expect(playoutCandidateBuild).toBeGreaterThan(workerCandidateBuild);
    expect(webSmoke).toBeGreaterThan(playoutCandidateBuild);
    expect(composeSmoke).toBeGreaterThan(webSmoke);
    expect(webPublish).toBeGreaterThan(composeSmoke);
    expect(workerPublish).toBeGreaterThan(webPublish);
    expect(playoutPublish).toBeGreaterThan(workerPublish);
    expect(firstPush).toBeGreaterThan(composeSmoke);
    expect(workflow).not.toContain("docker/build-push-action@v6");
    expect(workflow).toContain('target_id="$(docker image inspect "$tag" --format \'{{.Id}}\')"');
  });

  it("adds restart policies to the always-on production services", () => {
    for (const serviceName of ["traefik", "web", "worker", "playout", "postgres", "redis"]) {
      expect(extractComposeServiceBlock(serviceName)).toContain("restart: unless-stopped");
    }
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
        body: '{"status":"ok","broadcastReady":false,"services":{"worker":"ok","playout":"ok","destination":"not-ready"},"playout":{"selectionReasonCode":"fallback","fallbackTier":"standby","crashLoopDetected":false}}\n'
      }
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("broadcastReady=false");
    expect(result.output).toContain("destination=not-ready");
  });
});
