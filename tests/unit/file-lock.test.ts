import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireFileLock } from "../../apps/worker/src/file-lock.js";

let dir = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-lock-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("acquireFileLock", () => {
  it("grants the lock when nothing holds it", async () => {
    const lockPath = path.join(dir, "vod.mp4.lock");

    const lock = await acquireFileLock(lockPath);

    expect(lock).not.toBeNull();
    await expect(fs.stat(lockPath)).resolves.toBeTruthy();
    await lock?.release();
  });

  it("refuses a second holder while the first is alive", async () => {
    const lockPath = path.join(dir, "vod.mp4.lock");
    const first = await acquireFileLock(lockPath);

    const second = await acquireFileLock(lockPath);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await first?.release();
  });

  it("grants the lock again after release", async () => {
    const lockPath = path.join(dir, "vod.mp4.lock");
    const first = await acquireFileLock(lockPath);
    await first?.release();

    const second = await acquireFileLock(lockPath);

    expect(second).not.toBeNull();
    await second?.release();
  });

  it("takes over a lock abandoned by a crashed holder", async () => {
    // A container killed mid-download leaves its lock file behind with a frozen mtime. Without
    // takeover the asset would never be cached again.
    const lockPath = path.join(dir, "vod.mp4.lock");
    await fs.writeFile(lockPath, JSON.stringify({ host: "dead", pid: 1 }));
    const longAgo = new Date(Date.now() - 10 * 60_000);
    await fs.utimes(lockPath, longAgo, longAgo);

    const lock = await acquireFileLock(lockPath, { staleMs: 120_000 });

    expect(lock).not.toBeNull();
    await lock?.release();
  });

  it("does not take over a lock whose holder is still refreshing it", async () => {
    const lockPath = path.join(dir, "vod.mp4.lock");
    await fs.writeFile(lockPath, JSON.stringify({ host: "alive", pid: 2 }));
    const recent = new Date(Date.now() - 5_000);
    await fs.utimes(lockPath, recent, recent);

    const lock = await acquireFileLock(lockPath, { staleMs: 120_000 });

    expect(lock).toBeNull();
  });

  it("keeps the lock fresh via heartbeat so a live holder is never mistaken for dead", async () => {
    const lockPath = path.join(dir, "vod.mp4.lock");
    const lock = await acquireFileLock(lockPath, { heartbeatMs: 10 });
    const initial = (await fs.stat(lockPath)).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 60));
    const refreshed = (await fs.stat(lockPath)).mtimeMs;

    expect(refreshed).toBeGreaterThan(initial);
    await lock?.release();
  });

  it("tolerates a double release", async () => {
    const lockPath = path.join(dir, "vod.mp4.lock");
    const lock = await acquireFileLock(lockPath);

    await lock?.release();

    await expect(lock?.release()).resolves.toBeUndefined();
  });

  it("serialises concurrent acquisition attempts to a single winner", async () => {
    const lockPath = path.join(dir, "vod.mp4.lock");

    const results = await Promise.all(Array.from({ length: 8 }, () => acquireFileLock(lockPath)));

    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
    await winners[0]?.release();
  });
});
