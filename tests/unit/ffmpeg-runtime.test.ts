import { describe, expect, it } from "vitest";
import {
  buildFfmpegInputArgs,
  describeFfmpegExit,
  getPlayoutReconnectConfig,
  isLikelyDestinationOutputError,
  shouldRequestImmediatePlayoutRetry,
  shouldSkipInitialSceneCapture
} from "../../apps/worker/src/ffmpeg-runtime";

describe("ffmpeg runtime helpers", () => {
  it("defaults scheduled reconnects to 48 hours", () => {
    expect(getPlayoutReconnectConfig({}).intervalHours).toBe(48);
    expect(getPlayoutReconnectConfig({}).intervalMs).toBe(48 * 60 * 60 * 1000);
    expect(getPlayoutReconnectConfig({}).windowSeconds).toBe(20);
  });

  it("allows positive scheduled reconnect overrides and ignores invalid values", () => {
    expect(getPlayoutReconnectConfig({ PLAYOUT_RECONNECT_HOURS: "12", PLAYOUT_RECONNECT_SECONDS: "45" })).toMatchObject({
      intervalHours: 12,
      intervalMs: 12 * 60 * 60 * 1000,
      windowSeconds: 45,
      windowMs: 45 * 1000
    });
    expect(getPlayoutReconnectConfig({ PLAYOUT_RECONNECT_HOURS: "0", PLAYOUT_RECONNECT_SECONDS: "nope" })).toMatchObject({
      intervalHours: 48,
      windowSeconds: 20
    });
  });

  it("adds reconnect flags for remote HTTP inputs", () => {
    expect(buildFfmpegInputArgs({ input: "https://cdn.example.com/vod.mp4", realtime: true })).toEqual([
      "-re",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_on_network_error",
      "1",
      "-reconnect_delay_max",
      "10",
      "-i",
      "https://cdn.example.com/vod.mp4"
    ]);
  });

  it("keeps local file inputs unchanged", () => {
    expect(buildFfmpegInputArgs({ input: "/app/data/media/replay.mp4", realtime: true })).toEqual([
      "-re",
      "-i",
      "/app/data/media/replay.mp4"
    ]);
  });

  it("supports looping remote inputs without dropping reconnect flags", () => {
    expect(buildFfmpegInputArgs({ input: "https://cdn.example.com/bed.mp3", loop: true })).toEqual([
      "-stream_loop",
      "-1",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_on_network_error",
      "1",
      "-reconnect_delay_max",
      "10",
      "-i",
      "https://cdn.example.com/bed.mp3"
    ]);
  });

  it("does not classify benign lag and trailer lines as destination failures", () => {
    expect(
      isLikelyDestinationOutputError("[vist#0:1/h264 @ 0x75004d07e1c0] Resumed reading at pts 269.950 with rate 1.050 after a lag of 0.316s")
    ).toBe(false);
    expect(
      isLikelyDestinationOutputError("[flv @ 0x7e2f5c25f800] Failed to update header with correct duration. Failed to update header with correct filesize.")
    ).toBe(false);
    expect(isLikelyDestinationOutputError("[in#0/mov,mp4 @ 0x741aa9de7940] Error during demuxing: I/O error")).toBe(false);
  });

  it("still classifies real output/write failures as destination failures", () => {
    expect(isLikelyDestinationOutputError("Connection reset while writing to a.rtmp.youtube.com")).toBe(true);
    expect(isLikelyDestinationOutputError("av_interleaved_write_frame(): Broken pipe")).toBe(true);
  });

  it("reports signal exits explicitly", () => {
    expect(describeFfmpegExit(null, "SIGTERM")).toBe("was terminated by signal SIGTERM");
  });

  it("requests an immediate retry for recoverable unplanned exits", () => {
    expect(shouldRequestImmediatePlayoutRetry({ planned: false, crashLoopDetected: false })).toBe(true);
    expect(shouldRequestImmediatePlayoutRetry({ planned: true, crashLoopDetected: false })).toBe(false);
    expect(shouldRequestImmediatePlayoutRetry({ planned: false, crashLoopDetected: true })).toBe(false);
  });

  it("skips blocking scene capture only for recent recovery starts", () => {
    const heartbeatAt = "2026-04-10T14:23:52.626Z";
    expect(
      shouldSkipInitialSceneCapture({
        overlayEnabled: true,
        switching: false,
        playoutStatus: "failed",
        lastExitCode: "",
        heartbeatAt,
        nowMs: new Date("2026-04-10T14:24:07.000Z").getTime()
      })
    ).toBe(false);
    expect(
      shouldSkipInitialSceneCapture({
        overlayEnabled: true,
        switching: false,
        playoutStatus: "failed",
        lastExitCode: "SIGBUS",
        heartbeatAt,
        nowMs: new Date("2026-04-10T14:24:07.000Z").getTime()
      })
    ).toBe(true);
    expect(
      shouldSkipInitialSceneCapture({
        overlayEnabled: true,
        switching: true,
        playoutStatus: "failed",
        lastExitCode: "SIGBUS",
        heartbeatAt,
        nowMs: new Date("2026-04-10T14:24:07.000Z").getTime()
      })
    ).toBe(false);
    expect(
      shouldSkipInitialSceneCapture({
        overlayEnabled: true,
        switching: false,
        playoutStatus: "failed",
        lastExitCode: "SIGBUS",
        heartbeatAt,
        nowMs: new Date("2026-04-10T14:26:00.000Z").getTime()
      })
    ).toBe(false);
  });
});
