import { describe, expect, it } from "vitest";
import {
  buildProgramFeedOutputTarget,
  buildUplinkFfmpegCommand,
  buildFfmpegInputArgs,
  describeFfmpegExit,
  getProgramFeedConfig,
  getRelayInputUrl,
  getRelayPublishUrl,
  getPlayoutReconnectConfig,
  getUplinkInputMode,
  isRelayModeEnabled,
  isLikelyDestinationOutputError,
  isLikelyProgramFeedInputError,
  isNaturalPlayoutBoundary,
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

  it("resolves relay mode and relay endpoints from env", () => {
    expect(isRelayModeEnabled({})).toBe(false);
    expect(isRelayModeEnabled({ STREAM247_RELAY_ENABLED: "1" })).toBe(true);
    expect(getUplinkInputMode({})).toBe("hls");
    expect(getUplinkInputMode({ STREAM247_UPLINK_INPUT_MODE: "rtmp" })).toBe("rtmp");
    expect(getRelayPublishUrl({})).toBe("rtmp://relay:1935/live/program");
    expect(getRelayInputUrl({ STREAM247_RELAY_INPUT_URL: "rtmp://relay:1935/live/custom" })).toBe(
      "rtmp://relay:1935/live/custom"
    );
  });

  it("builds the default buffered HLS program feed target", () => {
    const config = getProgramFeedConfig({}, "/app/data/media");
    expect(config).toMatchObject({
      directory: "/app/data/media/.stream247-program-feed",
      playlistPath: "/app/data/media/.stream247-program-feed/program.m3u8",
      targetSeconds: 2,
      listSize: 30,
      bufferedSeconds: 60,
      failoverSeconds: 10
    });
    expect(buildProgramFeedOutputTarget(config, "run-1")).toEqual({
      muxer: "hls",
      output: "/app/data/media/.stream247-program-feed/program.m3u8",
      outputArgs: [
        "-hls_time",
        "2",
        "-hls_list_size",
        "30",
        "-hls_start_number_source",
        "epoch_us",
        "-hls_flags",
        "append_list+delete_segments+program_date_time+independent_segments+omit_endlist+temp_file+discont_start",
        "-hls_segment_filename",
        "/app/data/media/.stream247-program-feed/segment-run-1-%05d.ts"
      ]
    });
  });

  it("builds a copy-mode uplink command from relay input to the active output target", () => {
    expect(
      buildUplinkFfmpegCommand("rtmp://relay:1935/live/program", {
        muxer: "tee",
        output: "[onfail=ignore:f=flv]rtmp://example/live/key|[onfail=ignore:f=flv]/tmp/out.flv"
      })
    ).toEqual([
      "-hide_banner",
      "-loglevel",
      "warning",
      "-fflags",
      "+genpts",
      "-i",
      "rtmp://relay:1935/live/program",
      "-c",
      "copy",
      "-f",
      "tee",
      "[onfail=ignore:f=flv]rtmp://example/live/key|[onfail=ignore:f=flv]/tmp/out.flv"
    ]);
  });

  it("builds a transcoding uplink command for the local HLS program feed", () => {
    expect(
      buildUplinkFfmpegCommand(
        "/app/data/media/.stream247-program-feed/program.m3u8",
        {
          muxer: "flv",
          output: "rtmp://live.twitch.tv/app/key"
        },
        { inputMode: "hls", env: {} }
      )
    ).toEqual([
      "-hide_banner",
      "-loglevel",
      "warning",
      "-fflags",
      "+genpts+discardcorrupt",
      "-err_detect",
      "ignore_err",
      "-max_reload",
      "10",
      "-m3u8_hold_counters",
      "1200",
      "-i",
      "/app/data/media/.stream247-program-feed/program.m3u8",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-maxrate",
      "4500k",
      "-bufsize",
      "9000k",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "60",
      "-tune",
      "zerolatency",
      "-bf",
      "0",
      "-c:a",
      "aac",
      "-ar",
      "44100",
      "-b:a",
      "160k",
      "-f",
      "flv",
      "rtmp://live.twitch.tv/app/key"
    ]);
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

  it("classifies local HLS feed input stalls separately from destination failures", () => {
    expect(isLikelyProgramFeedInputError("Error opening input /app/data/media/.stream247-program-feed/program.m3u8")).toBe(true);
    expect(isLikelyProgramFeedInputError("Failed to reload playlist 0")).toBe(true);
  });

  it("reports signal exits explicitly", () => {
    expect(describeFfmpegExit(null, "SIGTERM")).toBe("was terminated by signal SIGTERM");
  });

  it("requests an immediate retry for recoverable unplanned exits", () => {
    expect(shouldRequestImmediatePlayoutRetry({ planned: false, crashLoopDetected: false })).toBe(true);
    expect(shouldRequestImmediatePlayoutRetry({ planned: true, crashLoopDetected: false })).toBe(false);
    expect(shouldRequestImmediatePlayoutRetry({ planned: false, crashLoopDetected: true })).toBe(false);
    expect(shouldRequestImmediatePlayoutRetry({ planned: false, naturalBoundary: true, crashLoopDetected: false })).toBe(true);
    expect(shouldRequestImmediatePlayoutRetry({ planned: true, naturalBoundary: true, crashLoopDetected: false })).toBe(false);
  });

  it("classifies clean asset and insert exits as natural playout boundaries", () => {
    expect(isNaturalPlayoutBoundary({ targetKind: "asset", code: 0, signal: null })).toBe(true);
    expect(isNaturalPlayoutBoundary({ targetKind: "insert", code: 0, signal: null })).toBe(true);
    expect(isNaturalPlayoutBoundary({ targetKind: "asset", code: 128, signal: null })).toBe(false);
    expect(isNaturalPlayoutBoundary({ targetKind: "live", code: 0, signal: null })).toBe(false);
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
