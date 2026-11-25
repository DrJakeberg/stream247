import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * scripts/design-baseline.sh reuses a dev stack that already answers on DEV_STACK_PORT. Reusing it
 * by re-seeding alone kept serving whatever image the containers were created from, so after
 * `pnpm test:design-baseline` rebuilt stream247-web:test the gate still compared (or recorded) the
 * old UI. The script must hand a running stack to `dev-stack.sh up`, which recreates containers
 * whose image or configuration changed.
 *
 * The script runs from a copy in a temporary root with stubs for curl, docker and dev-stack.sh, so
 * no container is touched.
 */

const rootDir = path.resolve(__dirname, "../..");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function stub(file: string, body: string) {
  writeFileSync(file, `#!/usr/bin/env sh\n${body}\n`);
  chmodSync(file, 0o755);
}

function runDesignBaseline(options: { stackRunning: boolean; args?: string[] }) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "stream247-design-baseline-"));
  tempDirs.push(tempRoot);
  const scriptsDir = path.join(tempRoot, "scripts");
  const binDir = path.join(tempRoot, "bin");
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  copyFileSync(path.join(rootDir, "scripts", "design-baseline.sh"), path.join(scriptsDir, "design-baseline.sh"));
  chmodSync(path.join(scriptsDir, "design-baseline.sh"), 0o755);

  const log = path.join(tempRoot, "calls.log");
  stub(path.join(scriptsDir, "dev-stack.sh"), `printf 'dev-stack %s\\n' "$*" >> "${log}"`);
  stub(path.join(binDir, "docker"), `printf 'docker %s\\n' "$*" >> "${log}"`);
  stub(path.join(binDir, "curl"), options.stackRunning ? "exit 0" : "exit 7");

  const output = execFileSync("bash", [path.join(scriptsDir, "design-baseline.sh"), ...(options.args ?? [])], {
    cwd: tempRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, DEV_STACK_PORT: "3999" }
  });
  return { output, calls: readFileSync(log, "utf8").trim().split("\n") };
}

describe("design-baseline.sh stack handling", () => {
  it("reconciles a running stack with dev-stack.sh up instead of only re-seeding it", () => {
    const { output, calls } = runDesignBaseline({ stackRunning: true });

    expect(output).toContain("Reusing the dev stack on http://127.0.0.1:3999.");
    expect(calls).toContain("dev-stack up");
    expect(calls).not.toContain("dev-stack seed");
    expect(calls.findIndex((line) => line === "dev-stack up")).toBeLessThan(
      calls.findIndex((line) => line.startsWith("docker run"))
    );
  });

  it("starts a stack with dev-stack.sh up when none answers", () => {
    const { output, calls } = runDesignBaseline({ stackRunning: false });

    expect(output).toContain("No dev stack on http://127.0.0.1:3999; starting one.");
    expect(calls.filter((line) => line.startsWith("dev-stack"))).toEqual(["dev-stack up"]);
  });

  it("passes --update through to Playwright on a reused stack", () => {
    const { calls } = runDesignBaseline({ stackRunning: true, args: ["--update"] });

    expect(calls).toContain("dev-stack up");
    expect(calls.find((line) => line.startsWith("docker run"))).toContain("--update-snapshots");
  });
});
