import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appendFfmpegOutputArgs,
  buildProgramFeedOutputTarget,
  buildUplinkFfmpegCommand,
  getProgramFeedConfig
} from "../../apps/worker/src/ffmpeg-runtime";
import { buildFfmpegOutputTarget } from "../../apps/worker/src/multi-output";

// M115: behind `tee` the encoder must be asked for a global header, or every flv output starts with an
// empty AVC sequence header that a stock RTMP server (MediaMTX) refuses. See appendFfmpegOutputArgs.
describe("tee outputs carry the encoder's global header (M115)", () => {
  const teeTarget = buildFfmpegOutputTarget([
    {
      destination: { id: "destination-primary" } as never,
      target: "rtmp://rtmp.example.org/live/key"
    }
  ]);

  function flagsBeforeMuxer(command: string[]): string[] {
    const muxerIndex = command.lastIndexOf("-f");
    const flagsIndex = command.indexOf("-flags:v");
    return flagsIndex === -1 || flagsIndex > muxerIndex ? [] : command.slice(flagsIndex, flagsIndex + 2);
  }

  it("asks for it on an encoded tee output, right before the muxer", () => {
    expect(teeTarget.muxer).toBe("tee");
    const command: string[] = ["-c:v", "libx264"];
    appendFfmpegOutputArgs(command, teeTarget);
    expect(command).toEqual(["-c:v", "libx264", "-flags:v", "+global_header", "-f", "tee", teeTarget.output]);
  });

  it("leaves a stream copy, the relay's flv output and the HLS program feed alone", () => {
    const copy: string[] = [];
    appendFfmpegOutputArgs(copy, teeTarget, { streamCopy: true });
    expect(copy).not.toContain("-flags:v");

    const relay: string[] = [];
    appendFfmpegOutputArgs(relay, { muxer: "flv", output: "rtmp://relay:1935/live/program" });
    expect(relay).toEqual(["-f", "flv", "rtmp://relay:1935/live/program"]);

    const feed: string[] = [];
    appendFfmpegOutputArgs(feed, buildProgramFeedOutputTarget(getProgramFeedConfig({}), "run"));
    expect(feed).not.toContain("-flags:v");
  });

  it("is on the uplink's encoded command and off its copy command", () => {
    const encoded = buildUplinkFfmpegCommand("/feed/program.m3u8", teeTarget, { inputMode: "hls", env: {} });
    expect(flagsBeforeMuxer(encoded)).toEqual(["-flags:v", "+global_header"]);

    const copied = buildUplinkFfmpegCommand("rtmp://relay:1935/live/program", teeTarget);
    expect(copied).toContain("copy");
    expect(copied).not.toContain("-flags:v");
  });

  it("is never skipped by the playout's own encoded commands (relay off, tee straight to the destinations)", () => {
    const source = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");
    const calls = source.match(/appendFfmpegOutputArgs\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      expect(call).not.toContain("streamCopy");
    }
  });
});
