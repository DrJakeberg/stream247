// The lock that release-readiness.test.ts and release-preflight.test.ts share while a test rewrites the
// repository's root .env. Vitest runs the two files in parallel, one process each, and each takes the lock
// per test.
//
// Two defects of the copy each file used to carry (M111):
// - It waited with Atomics.wait, which blocks the worker: a wait longer than vitest's RPC timeout ended the
//   run with "[vitest-worker]: Timeout calling onTaskUpdate" (CI, 2026-10-21). The wait is asynchronous now.
// - It was not fair. A file released the lock and took it again in its next beforeEach before the other
//   file's next poll, so the other file waited out the whole run of the first; since M111 release-readiness
//   runs about 30 s under the full suite, as long as the old deadline. A waiter now announces itself, and a
//   file that releases the lock lets an announced waiter take it before it goes on.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const rootEnvLockPath = path.join(os.tmpdir(), "stream247-release-root-env.lock");
const waitersPath = `${rootEnvLockPath}.waiting`;

/** How long a test waits for the lock: the other file's longest single test, with room. */
export const ROOT_ENV_LOCK_WAIT_MS = 120_000;
/** How long a release waits for an announced waiter to take the lock before it goes on. */
export const ROOT_ENV_LOCK_HANDOVER_MS = 10_000;
const POLL_MS = 25;

let held = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Another live process waits for the lock (a waiter of a crashed run does not count). */
function othersWaiting(): boolean {
  let names: string[];
  try {
    names = readdirSync(waitersPath);
  } catch {
    return false;
  }
  return names.some((name) => {
    const pid = Number(name.split("-")[0]);
    return pid !== process.pid && Number.isInteger(pid) && isAlive(pid);
  });
}

export async function acquireRootEnvLock(): Promise<void> {
  const deadline = Date.now() + ROOT_ENV_LOCK_WAIT_MS;
  const waiterPath = path.join(waitersPath, `${process.pid}-${Date.now()}`);
  let announced = false;

  try {
    while (Date.now() < deadline) {
      try {
        mkdirSync(rootEnvLockPath);
        held = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
      if (!announced) {
        mkdirSync(waitersPath, { recursive: true });
        writeFileSync(waiterPath, "");
        announced = true;
      }
      await sleep(POLL_MS);
    }
    throw new Error(`Timed out waiting for ${rootEnvLockPath}`);
  } finally {
    if (announced) {
      rmSync(waiterPath, { force: true });
    }
  }
}

export async function releaseRootEnvLock(): Promise<void> {
  if (!held) {
    return;
  }
  rmSync(rootEnvLockPath, { force: true, recursive: true });
  held = false;

  // Hand over: a waiter's announcement disappears once it holds the lock (or gives up).
  const deadline = Date.now() + ROOT_ENV_LOCK_HANDOVER_MS;
  while (Date.now() < deadline && othersWaiting()) {
    await sleep(POLL_MS);
  }
}
