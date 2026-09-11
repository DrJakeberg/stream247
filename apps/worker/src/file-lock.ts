// Cross-process advisory file lock on a shared volume.
//
// The worker and playout containers mount the same media volume, so both can decide to cache the
// same Twitch VOD. Since a background cache job writes to a *stable* part path (so an interrupted
// download resumes instead of restarting), two concurrent jobs would interleave writes into one
// file and produce a corrupt result. This lock makes exactly one of them win.
//
// The lock is advisory and crash-safe: the holder refreshes the lock file's mtime while it works,
// and a lock whose mtime has not moved for longer than `staleMs` is considered abandoned and can
// be taken over. That way a container killed mid-download does not block caching forever.

import { promises as fs } from "node:fs";
import os from "node:os";

export const DEFAULT_LOCK_HEARTBEAT_MS = 30_000;
export const DEFAULT_LOCK_STALE_MS = 120_000;

export type FileLock = {
  /** Stop the heartbeat and remove the lock file. Safe to call more than once. */
  release: () => Promise<void>;
};

type AcquireOptions = {
  heartbeatMs?: number;
  staleMs?: number;
  now?: () => number;
};

function describeHolder(): string {
  return JSON.stringify({ host: os.hostname(), pid: process.pid, at: new Date().toISOString() });
}

async function getMtimeMs(lockPath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(lockPath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Try to take the lock. Returns null when another live holder has it.
 */
export async function acquireFileLock(lockPath: string, options: AcquireOptions = {}): Promise<FileLock | null> {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_LOCK_HEARTBEAT_MS;
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const now = options.now ?? (() => Date.now());

  const taken = await tryCreate(lockPath);
  if (!taken) {
    const mtimeMs = await getMtimeMs(lockPath);
    if (mtimeMs === null) {
      // The holder released it between our create attempt and the stat; try once more.
      if (!(await tryCreate(lockPath))) {
        return null;
      }
    } else if (now() - mtimeMs < staleMs) {
      return null;
    } else {
      // Abandoned lock: remove it and race for a fresh one. If someone else wins that race, back off.
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
      if (!(await tryCreate(lockPath))) {
        return null;
      }
    }
  }

  let released = false;
  const heartbeat = setInterval(() => {
    const stamp = new Date();
    void fs.utimes(lockPath, stamp, stamp).catch(() => undefined);
  }, heartbeatMs);
  // Never keep the process alive just for a lock heartbeat.
  heartbeat.unref?.();

  return {
    async release() {
      if (released) {
        return;
      }
      released = true;
      clearInterval(heartbeat);
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
  };
}

async function tryCreate(lockPath: string): Promise<boolean> {
  try {
    await fs.writeFile(lockPath, describeHolder(), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}
