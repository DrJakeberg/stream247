import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { execFileText } from "../../apps/worker/src/process-utils";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }

    await rm(dir, { recursive: true, force: true });
  }
});

describe("process utils", () => {
  it("returns trimmed stdout for successful commands", async () => {
    await expect(execFileText(process.execPath, ["-e", "process.stdout.write('ok\\n')"])).resolves.toBe("ok");
  });

  it("times out and kills the spawned process group", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "stream247-process-utils-"));
    tempDirs.push(tempDir);
    const childPidPath = path.join(tempDir, "child.pid");

    await expect(
      execFileText(
        "/bin/sh",
        [
          "-c",
          `sleep 1000 & echo $! > ${JSON.stringify(childPidPath)}; wait`
        ],
        {
          timeoutMs: 300,
          killProcessGroup: true,
          forceKillAfterMs: 100
        }
      )
    ).rejects.toThrow(/timed out after 300ms/i);

    const childPid = Number((await readFile(childPidPath, "utf8")).trim());
    await delay(200);

    let childStillRunning = true;
    try {
      process.kill(childPid, 0);
    } catch {
      childStillRunning = false;
    }

    expect(childStillRunning).toBe(false);
  });
});
