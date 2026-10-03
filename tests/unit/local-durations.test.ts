import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMaterializedProgrammingWeek, type ScheduleBlock } from "@stream247/core";
import { chooseStoredAssetSyncFields } from "@stream247/db";
import {
  buildDurationProbeKey,
  parseFfprobeDurationSeconds,
  probeLocalFileDurationSeconds,
  resolveLocalFileDurations,
  type LocalDurationEntry
} from "../../apps/worker/src/local-durations";

/**
 * M96: local-library files carry their real length.
 *
 * The probe tests run against real ffprobe on generated files where ffmpeg is installed (locally, the
 * worker image); CI's validate job has no host ffmpeg, so there they skip and the stubbed tests below
 * carry the logic.
 */
const ffmpegAvailable =
  spawnSync("ffmpeg", ["-hide_banner", "-version"]).status === 0 && spawnSync("ffprobe", ["-hide_banner", "-version"]).status === 0;

// 2026-10-05 is a Monday.
const block: ScheduleBlock = {
  id: "block-local",
  title: "Local library",
  categoryName: "Archive",
  sourceName: "Pool",
  dayOfWeek: 1,
  // A 24/7 day, as in the research measurement (planning/research/ux-install.md, U4).
  startMinuteOfDay: 0,
  durationMinutes: 24 * 60,
  poolId: "pool-local"
};
const pool = {
  id: "pool-local",
  name: "Local",
  sourceIds: ["source-local-library"],
  cursorAssetId: "",
  insertAssetId: "",
  insertEveryItems: 0,
  itemsSinceInsert: 0
};

function dayLens(durations: Array<number | undefined>) {
  const assets = durations.map((durationSeconds, index) => ({
    id: `asset-${String(index + 1)}`,
    sourceId: "source-local-library",
    title: `Folge ${String(index + 1)}`,
    status: "ready",
    includeInProgramming: true,
    durationSeconds,
    createdAt: "2026-10-01T00:00:00.000Z"
  }));
  const day = buildMaterializedProgrammingWeek({ startDate: "2026-10-05", blocks: [block], pools: [pool], assets })[0];
  const entry = day?.blocks[0];
  // The Day lens line, as apps/web/app/(admin)/schedule/page.tsx prints it.
  return `Unique library: ${String(entry?.uniqueMinutes)}m · Projected: ${String(entry?.projectedMinutes)}m`;
}

describe("local file durations (M96)", () => {
  it("parses ffprobe's format duration into whole seconds, 0 when there is none", () => {
    expect(parseFfprobeDurationSeconds("120.021333\n")).toBe(120);
    expect(parseFfprobeDurationSeconds("119.6")).toBe(120);
    expect(parseFfprobeDurationSeconds("0.2")).toBe(1);
    expect(parseFfprobeDurationSeconds("N/A\n")).toBe(0);
    expect(parseFfprobeDurationSeconds("")).toBe(0);
    expect(parseFfprobeDurationSeconds("-3")).toBe(0);
  });

  it("keys a file version by size and modification time", () => {
    expect(buildDurationProbeKey({ size: 1024, mtimeMs: 1_759_000_000_123.456 })).toBe("1024:1759000000123");
  });

  it("probes a file once and not again while it is unchanged; a changed file is probed once more", async () => {
    const stats: Record<string, { size: number; mtimeMs: number }> = {
      "/media/a.mp4": { size: 100, mtimeMs: 1000 },
      "/media/b.mp4": { size: 200, mtimeMs: 2000 }
    };
    const stat = async (filePath: string) => stats[filePath]!;
    const probe = vi.fn(async (filePath: string) => (filePath.endsWith("a.mp4") ? 120 : 300));

    const first = await resolveLocalFileDurations({ files: Object.keys(stats), existingByPath: new Map(), stat, probe });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(first.entries.get("/media/a.mp4")).toEqual({ durationSeconds: 120, durationProbeKey: "100:1000" });
    expect(first.entries.get("/media/b.mp4")).toEqual({ durationSeconds: 300, durationProbeKey: "200:2000" });

    probe.mockClear();
    const second = await resolveLocalFileDurations({ files: Object.keys(stats), existingByPath: first.entries, stat, probe });
    expect(probe).not.toHaveBeenCalled();
    expect(second.probed).toBe(0);
    expect(second.entries).toEqual(first.entries);

    stats["/media/b.mp4"] = { size: 250, mtimeMs: 3000 };
    const third = await resolveLocalFileDurations({ files: Object.keys(stats), existingByPath: second.entries, stat, probe });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith("/media/b.mp4");
    expect(third.entries.get("/media/b.mp4")).toEqual({ durationSeconds: 300, durationProbeKey: "250:3000" });
  });

  it("stores the key of a file ffprobe cannot read, so it is not probed on every scan", async () => {
    const stat = async () => ({ size: 1, mtimeMs: 1 });
    const probe = vi.fn(async () => {
      throw new Error("Invalid data found when processing input");
    });
    const first = await resolveLocalFileDurations({ files: ["/media/broken.mp4"], existingByPath: new Map(), stat, probe });
    expect(first).toMatchObject({ probed: 1, failed: 1 });
    expect(first.entries.get("/media/broken.mp4")).toEqual({ durationSeconds: 0, durationProbeKey: "1:1" });

    const second = await resolveLocalFileDurations({ files: ["/media/broken.mp4"], existingByPath: first.entries, stat, probe });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(second.probed).toBe(0);
  });

  it("stops starting probes when the scan budget is spent and leaves the rest for the next scan", async () => {
    let clock = 0;
    const files = ["/media/1.mp4", "/media/2.mp4", "/media/3.mp4", "/media/4.mp4"];
    const stat = async (filePath: string) => ({ size: files.indexOf(filePath) + 1, mtimeMs: 1 });
    const probe = vi.fn(async () => {
      clock += 400;
      return 60;
    });
    const first = await resolveLocalFileDurations({ files, existingByPath: new Map(), stat, probe, nowMs: () => clock, budgetMs: 1000 });
    // 0 ms, 400 ms and 800 ms are inside the budget; at 1200 ms the fourth waits.
    expect(first).toMatchObject({ probed: 3, deferred: 1 });
    expect(first.entries.has("/media/4.mp4")).toBe(false);

    const second = await resolveLocalFileDurations({ files, existingByPath: first.entries, stat, probe, nowMs: () => clock, budgetMs: 1000 });
    expect(second).toMatchObject({ probed: 1, deferred: 0 });
    expect(second.entries.get("/media/4.mp4")).toEqual({ durationSeconds: 60, durationProbeKey: "4:1" });
  });

  it("skips a file whose stat fails and keeps nothing for it, so the stored values stay", async () => {
    const probe = vi.fn(async () => 60);
    const result = await resolveLocalFileDurations({
      files: ["/media/gone.mp4"],
      existingByPath: new Map([["/media/gone.mp4", { durationSeconds: 90, durationProbeKey: "9:9" }]]),
      stat: async () => {
        throw new Error("ENOENT");
      },
      probe
    });
    expect(probe).not.toHaveBeenCalled();
    expect(result.entries.size).toBe(0);
  });

  it("stores a probed local duration for its own file version, and a failed probe of a new version reads unknown", () => {
    const syncNow = "2026-10-03T12:00:00.000Z";
    expect(
      chooseStoredAssetSyncFields({ durationSeconds: 120 }, { createdAt: syncNow, durationSeconds: 300, durationProbeKey: "2:2" }).durationSeconds
    ).toBe(300);
    expect(
      chooseStoredAssetSyncFields({ durationSeconds: 120 }, { createdAt: syncNow, durationSeconds: 0, durationProbeKey: "2:2" }).durationSeconds
    ).toBe(0);
    // Remote listings keep the old rule: no duration in the listing never erases a known one.
    expect(chooseStoredAssetSyncFields({ durationSeconds: 120 }, { createdAt: syncNow, durationSeconds: 0 }).durationSeconds).toBe(120);
  });

  it("Day lens: three two-minute files read 6m of unique library, not three 30-minute estimates", () => {
    expect(dayLens([undefined, undefined, undefined])).toBe("Unique library: 90m · Projected: 1440m");
    // Projected stops at the preview's item cap (48 items), so only the unique part is fixed here.
    expect(dayLens([120, 120, 120])).toMatch(/^Unique library: 6m · /);
  });

  describe.runIf(ffmpegAvailable)("against real ffprobe", () => {
    let directory = "";
    const files: string[] = [];

    beforeAll(() => {
      directory = mkdtempSync(path.join(tmpdir(), "stream247-m96-"));
      const first = path.join(directory, "folge-1.mp4");
      const generated = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=64x36:r=5",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=8000:cl=mono",
          "-t",
          "120",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-c:a",
          "aac",
          "-shortest",
          "-y",
          first
        ],
        { encoding: "utf8" }
      );
      expect(generated.status, generated.stderr).toBe(0);
      files.push(first);
      for (const name of ["folge-2.mp4", "folge-3.mp4"]) {
        const copy = path.join(directory, name);
        spawnSync("cp", [first, copy]);
        files.push(copy);
      }
    }, 120_000);

    afterAll(() => {
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it("reads a generated two-minute file as 120 s, within one second", async () => {
      const seconds = await probeLocalFileDurationSeconds(files[0]!);
      expect(Math.abs(seconds - 120)).toBeLessThanOrEqual(1);
    });

    it("probes three real files once, not again while unchanged, and the Day lens reads 6m", async () => {
      const probe = vi.fn((filePath: string) => probeLocalFileDurationSeconds(filePath));
      const first = await resolveLocalFileDurations({ files, existingByPath: new Map(), probe });
      expect(probe).toHaveBeenCalledTimes(3);

      probe.mockClear();
      const second = await resolveLocalFileDurations({ files, existingByPath: first.entries, probe });
      expect(probe).not.toHaveBeenCalled();

      const durations = files.map((filePath) => (second.entries.get(filePath) as LocalDurationEntry).durationSeconds);
      expect(dayLens(durations)).toMatch(/^Unique library: 6m · /);

      // Touching a file makes it a new version: probed once more.
      const later = new Date(Date.now() + 60_000);
      utimesSync(files[2]!, later, later);
      await resolveLocalFileDurations({ files, existingByPath: second.entries, probe });
      expect(probe).toHaveBeenCalledTimes(1);
      expect(probe).toHaveBeenCalledWith(files[2]);
    });

    it("reads a file that is not media as unknown", async () => {
      const junk = path.join(directory, "junk.mp4");
      writeFileSync(junk, "not a video");
      await expect(probeLocalFileDurationSeconds(junk)).rejects.toThrow();
    });
  });
});
