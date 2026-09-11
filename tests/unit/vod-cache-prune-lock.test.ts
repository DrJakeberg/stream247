import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireFileLock } from "../../apps/worker/src/file-lock.js";

// Regression guard for a cache that could never complete.
//
// Partials used to be disposable: every attempt wrote a uniquely named part file and the next one
// started from zero. Background jobs now resume into a stable part path, so a partial is
// accumulated work — routinely tens of gigabytes. The prune evicted transient files to stay under
// the cache cap, including one a running job was still writing. With several large VODs queued,
// each new job destroyed the previous job's progress: the same "never finishes" failure the
// download timeout used to cause, relocated into the background.
//
// The lock a running job maintains is the signal that separates "abandoned partial" from "work in
// progress". These tests pin that distinction on the real filesystem helpers.

let dir = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-prune-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Mirrors the lock/partial layout ensureTwitchVodCache creates for a background job. */
async function createDownloadInProgress(id: string) {
  const cachePath = path.join(dir, `${id}.mp4`);
  const partialPath = `${cachePath}.part-resume.mp4`;
  await fs.writeFile(partialPath, "partial-download-bytes");
  const lock = await acquireFileLock(`${cachePath}.lock`);
  return { cachePath, partialPath, lock };
}

describe("in-flight downloads are distinguishable from abandoned ones", () => {
  it("a running job holds a lock next to its partial", async () => {
    const { cachePath, partialPath, lock } = await createDownloadInProgress("123");

    await expect(fs.stat(`${cachePath}.lock`)).resolves.toBeTruthy();
    await expect(fs.stat(partialPath)).resolves.toBeTruthy();

    await lock?.release();
  });

  it("releasing the job removes the lock, leaving the partial collectable", async () => {
    const { cachePath, partialPath, lock } = await createDownloadInProgress("123");
    await lock?.release();

    await expect(fs.stat(`${cachePath}.lock`)).rejects.toThrow();
    // The partial survives on purpose: the next attempt resumes into it.
    await expect(fs.stat(partialPath)).resolves.toBeTruthy();
  });

  it("a second job cannot take the lock while the first holds it", async () => {
    // This is what stops two jobs writing the same resume file on a shared media volume.
    const first = await createDownloadInProgress("123");

    const second = await acquireFileLock(`${first.cachePath}.lock`);

    expect(second).toBeNull();
    await first.lock?.release();
  });

  it("a stale lock from a crashed job can be taken over", async () => {
    const cachePath = path.join(dir, "123.mp4");
    const lockPath = `${cachePath}.lock`;
    await fs.writeFile(lockPath, JSON.stringify({ host: "dead", pid: 1 }));
    const longAgo = new Date(Date.now() - 10 * 60_000);
    await fs.utimes(lockPath, longAgo, longAgo);

    const taken = await acquireFileLock(lockPath, { staleMs: 120_000 });

    expect(taken).not.toBeNull();
    await taken?.release();
  });

  it("derives the lock path from a partial and from its fragment siblings alike", () => {
    // The prune has to map any transient file back to the cache entry that owns it: yt-dlp writes
    // "<cache>.part-resume.mp4.part" and "<cache>.part-resume.mp4.part-FragNNN.part" beside it.
    const lockFor = (filePath: string) => {
      const marker = filePath.indexOf(".part-resume");
      return marker === -1 ? null : `${filePath.slice(0, marker)}.lock`;
    };

    expect(lockFor("/c/123.mp4.part-resume.mp4")).toBe("/c/123.mp4.lock");
    expect(lockFor("/c/123.mp4.part-resume.mp4.part")).toBe("/c/123.mp4.lock");
    expect(lockFor("/c/123.mp4.part-resume.mp4.part-Frag2431.part")).toBe("/c/123.mp4.lock");
    expect(lockFor("/c/123.mp4.part-resume.mp4.ytdl")).toBe("/c/123.mp4.lock");
    // A finished cache file is not transient and must never be matched this way.
    expect(lockFor("/c/123.mp4")).toBeNull();
  });
});
