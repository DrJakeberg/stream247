import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFfmpegInputArgs } from "../../apps/worker/src/ffmpeg-runtime";
import { mediaToolsAvailable } from "../support/media-tools";

/**
 * M124: an interrupted item continues at its position with `-ss` before `-i`. Against real ffmpeg: a file
 * that is red for 20 s and blue for 10 s, with one keyframe only (at 0), starts blue at 20 s and red at
 * 19 s, and runs for what is left. Input seeking that snapped to a keyframe would start red at 0 both
 * times. CI runs this in `pnpm test:media` (M121), where a missing ffmpeg fails instead of skipping.
 */
const ffmpegAvailable = mediaToolsAvailable("ffmpeg", "ffprobe");

let dir = "";
let fixture = "";

function run(tool: string, args: string[]): string {
  const result = spawnSync(tool, args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${tool} ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString("latin1");
}

/** The first frame of the input started at `startSeconds`, as one RGB pixel, and the length that is left. */
function startAt(startSeconds: number): { rgb: number[]; durationSeconds: number } {
  const input = buildFfmpegInputArgs({ input: fixture, startSeconds });
  const pixel = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", ...input, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer" }
  );
  if (pixel.status !== 0) {
    throw new Error(pixel.stderr.toString());
  }
  const output = path.join(dir, `from-${String(startSeconds)}.mp4`);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...input, "-c:v", "libx264", "-preset", "ultrafast", output]);
  const duration = Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output]).trim());
  return { rgb: [...pixel.stdout.subarray(0, 3)], durationSeconds: duration };
}

describe.skipIf(!ffmpegAvailable)("continuing an item at its position, with real ffmpeg", () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "stream247-resume-seek-"));
    fixture = path.join(dir, "red-then-blue.mp4");
    run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:r=10:d=20[a];color=c=blue:s=64x64:r=10:d=10[b];[a][b]concat=n=2:v=1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      // One keyframe for the whole file: a seek that snapped to it would start at 0.
      "-g",
      "1000",
      "-keyint_min",
      "1000",
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      fixture
    ]);
  });

  afterAll(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts -ss before -i, and nothing for a start from the beginning", () => {
    expect(buildFfmpegInputArgs({ input: "/media/a.mp4", realtime: true, startSeconds: 4510 })).toEqual([
      "-re",
      "-ss",
      "4510",
      "-i",
      "/media/a.mp4"
    ]);
    expect(buildFfmpegInputArgs({ input: "/media/a.mp4", realtime: true, startSeconds: 0 })).toEqual(["-re", "-i", "/media/a.mp4"]);
  });

  it("starts at the position, not at the keyframe before it", () => {
    const blue = startAt(20);
    expect(blue.rgb[2]).toBeGreaterThan(200);
    expect(blue.rgb[0]).toBeLessThan(60);
    expect(blue.durationSeconds).toBeGreaterThan(9.5);
    expect(blue.durationSeconds).toBeLessThan(10.5);

    const red = startAt(19);
    expect(red.rgb[0]).toBeGreaterThan(200);
    expect(red.rgb[2]).toBeLessThan(60);
    expect(red.durationSeconds).toBeGreaterThan(10.5);
    expect(red.durationSeconds).toBeLessThan(11.5);
  });
});
