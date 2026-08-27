import { describe, expect, it } from "vitest";
import { WATCHDOG_LIMITS } from "@stream247/core";
import {
  buildProgramFeedOutputTarget,
  buildUplinkFfmpegCommand,
  buildFfmpegInputArgs,
  buildSourceLivePipFilterComplex,
  buildSourceLivePipInputArgs,
  decideLiveSourceAudio,
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
  shouldSkipInitialSceneCapture,
  SOURCE_LIVE_RTSP_TIMEOUT_US
} from "../../apps/worker/src/ffmpeg-runtime";
import {
  getOutputGopSize,
  getOutputVideoFilter,
  getWorkerStreamOutputSettings,
  isStreamScaleEnabled
} from "../../apps/worker/src/output-settings";

describe("ffmpeg runtime helpers", () => {
  const teeRecoveryOptions =
    "onfail=ignore:f=flv:use_fifo=1:fifo_options=attempt_recovery=1\\\\:recover_any_error=1\\\\:recovery_wait_time=1";

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

  it("resolves managed reconnect cadence first (M56 part 2)", () => {
    expect(
      getPlayoutReconnectConfig({ PLAYOUT_RECONNECT_HOURS: "12" }, { playoutReconnectHours: "24", playoutReconnectWindowSeconds: "30" })
    ).toMatchObject({
      intervalHours: 24,
      intervalMs: 24 * 60 * 60 * 1000,
      windowSeconds: 30,
      windowMs: 30 * 1000
    });
  });

  it("resolves managed program-feed geometry first, derived fields included (M56 part 2)", () => {
    const config = getProgramFeedConfig({ STREAM247_PROGRAM_FEED_TARGET_SECONDS: "2" }, "/app/data/media", {
      programFeedTargetSeconds: "4",
      programFeedListSize: "15",
      programFeedFailoverSeconds: "5"
    });

    expect(config).toMatchObject({
      targetSeconds: 4,
      listSize: 15,
      bufferedSeconds: 60,
      failoverSeconds: 5
    });
    // The directory stays infrastructure: env decides where the feed lives, never the GUI.
    expect(config.directory).toBe("/app/data/media/.stream247-program-feed");
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
        "-hls_flags",
        "append_list+delete_segments+program_date_time+independent_segments+omit_endlist+temp_file+discont_start",
        "-hls_segment_filename",
        "/app/data/media/.stream247-program-feed/segment-run-1-%05d.ts"
      ]
    });
  });

  describe("program-feed boundary continuity for the persistent uplink", () => {
    // Regression for the v1.5.15 soak failure: -hls_start_number_source epoch_us made every new
    // playout run restart EXT-X-MEDIA-SEQUENCE at epoch-microseconds, so each clean asset boundary
    // jumped the sequence by ~elapsed-us. The uplink HLS demuxer logged "skipping 552960321
    // segments ahead, expired from playlists", hit EOF, and exited (unplanned restart) at every
    // boundary until destination=degraded.
    it("does not override the HLS start number source — append_list must continue MEDIA-SEQUENCE across playout runs", () => {
      const config = getProgramFeedConfig({}, "/app/data/media");
      const args = buildProgramFeedOutputTarget(config, "run-1").outputArgs ?? [];

      expect(args).not.toContain("-hls_start_number_source");
      expect(args).not.toContain("epoch_us");
    });

    it("keeps explicit boundary signaling and append semantics (append_list + discont_start + omit_endlist)", () => {
      const config = getProgramFeedConfig({}, "/app/data/media");
      const args = buildProgramFeedOutputTarget(config, "run-1").outputArgs ?? [];
      const flagsIndex = args.indexOf("-hls_flags");

      expect(flagsIndex).toBeGreaterThanOrEqual(0);
      const flags = String(args[flagsIndex + 1]);
      expect(flags).toContain("append_list");
      expect(flags).toContain("discont_start");
      expect(flags).toContain("omit_endlist");
    });

    it("keeps per-run segment names unique via the runId so consecutive runs cannot collide", () => {
      const config = getProgramFeedConfig({}, "/app/data/media");
      const first = buildProgramFeedOutputTarget(config, "run-1").outputArgs ?? [];
      const second = buildProgramFeedOutputTarget(config, "run-2").outputArgs ?? [];
      const segmentOf = (args: string[]) => String(args[args.indexOf("-hls_segment_filename") + 1]);

      expect(segmentOf(first)).toContain("run-1");
      expect(segmentOf(second)).toContain("run-2");
      expect(segmentOf(first)).not.toBe(segmentOf(second));
    });

    it("keeps the persistent uplink input tolerant of in-band boundary discontinuities", () => {
      const command = buildUplinkFfmpegCommand(
        "/app/data/media/.stream247-program-feed/program.m3u8",
        { muxer: "flv", output: "rtmp://live.twitch.tv/app/key" },
        { inputMode: "hls", env: {}, outputSettings: null }
      );

      const fflagsIndex = command.indexOf("-fflags");
      expect(fflagsIndex).toBeGreaterThanOrEqual(0);
      expect(String(command[fflagsIndex + 1])).toContain("+genpts");
      expect(String(command[fflagsIndex + 1])).toContain("+discardcorrupt");
      expect(command).toContain("-err_detect");
      expect(command).toContain("-m3u8_hold_counters");
    });
  });

  it("resolves stream output profiles and builds the scale/pad/fps video filter", () => {
    const settings = getWorkerStreamOutputSettings(
      {
        STREAM_OUTPUT_WIDTH: "640",
        STREAM_OUTPUT_HEIGHT: "360",
        STREAM_OUTPUT_FPS: "30"
      },
      {
        profileId: "1080p30",
        width: 1920,
        height: 1080,
        fps: 30,
        updatedAt: "2026-04-20T10:00:00.000Z"
      }
    );

    expect(settings).toEqual({
      profileId: "custom",
      width: 640,
      height: 360,
      fps: 30
    });
    expect(getOutputVideoFilter(settings)).toBe(
      "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1"
    );
    expect(getOutputGopSize(settings)).toBe("60");
    expect(isStreamScaleEnabled({})).toBe(true);
    expect(isStreamScaleEnabled({ STREAM_SCALE_ENABLED: "0" })).toBe(false);
  });

  it("builds a copy-mode uplink command from relay input to the active output target", () => {
    expect(
      buildUplinkFfmpegCommand("rtmp://relay:1935/live/program", {
        muxer: "tee",
        output: `[${teeRecoveryOptions}]rtmp://example/live/key|[${teeRecoveryOptions}:flush_packets=1]/tmp/out.flv`
      })
    ).toEqual([
      "-hide_banner",
      "-loglevel",
      "warning",
      "-progress",
      "pipe:1",
      "-nostats",
      "-fflags",
      "+genpts",
      "-i",
      "rtmp://relay:1935/live/program",
      "-c",
      "copy",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-f",
      "tee",
      `[${teeRecoveryOptions}]rtmp://example/live/key|[${teeRecoveryOptions}:flush_packets=1]/tmp/out.flv`
    ]);
  });

  it("transcodes relay input when a destination-specific output profile is requested", () => {
    expect(
      buildUplinkFfmpegCommand(
        "rtmp://relay:1935/live/program",
        {
          muxer: "flv",
          output: "rtmp://live.example.com/app/key"
        },
        {
          outputSettings: {
            profileId: "360p30",
            width: 640,
            height: 360,
            fps: 30
          },
          env: {}
        }
      )
    ).toEqual([
      "-hide_banner",
      "-loglevel",
      "warning",
      "-progress",
      "pipe:1",
      "-nostats",
      "-fflags",
      "+genpts",
      "-i",
      "rtmp://relay:1935/live/program",
      "-vf",
      "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-maxrate",
      "1200k",
      "-bufsize",
      "2400k",
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
      "rtmp://live.example.com/app/key"
    ]);
  });

  it("prefers managed encoder settings over env and the rate ladder (M56)", () => {
    const command = buildUplinkFfmpegCommand(
      "rtmp://relay:1935/live/program",
      { muxer: "flv", output: "rtmp://live.example.com/app/key" },
      {
        outputSettings: { profileId: "360p30", width: 640, height: 360, fps: 30 },
        env: { FFMPEG_PRESET: "ultrafast" } as NodeJS.ProcessEnv,
        managedConfig: { ffmpegPreset: "medium", ffmpegMaxrate: "3000k" }
      }
    );

    // The managed preset beats the env preset, and one managed rate value is enough to switch
    // from the 360p ladder step (1200k/2400k) to the explicitly configured trio with defaults.
    expect(command).toContain("medium");
    expect(command).not.toContain("ultrafast");
    expect(command).toContain("3000k");
    expect(command).toContain("9000k");
    expect(command).not.toContain("1200k");
  });

  it("builds a transcoding uplink command for the local HLS program feed", () => {
    expect(
      buildUplinkFfmpegCommand(
        "/app/data/media/.stream247-program-feed/program.m3u8",
        { muxer: "tee", output: `[${teeRecoveryOptions}]rtmp://live.twitch.tv/app/key` },
        { inputMode: "hls", env: {} }
      )
    ).toEqual([
      "-hide_banner",
      "-loglevel",
      "warning",
      "-progress",
      "pipe:1",
      "-nostats",
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
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-f",
      "tee",
      `[${teeRecoveryOptions}]rtmp://live.twitch.tv/app/key`
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

describe("live-attached source input args (M57 stage 2, Etappe C)", () => {
  it("pins RTSP to TCP with the bounded socket timeout, in that order", () => {
    expect(buildSourceLivePipInputArgs("rtsp://reader:key@relay:8554/src-front-desk")).toEqual([
      "-rtsp_transport",
      "tcp",
      "-timeout",
      "4000000",
      "-i",
      "rtsp://reader:key@relay:8554/src-front-desk"
    ]);
  });

  it("carries no -re, no loop and no reconnect: a dropped source must fall away, not hold the encode", () => {
    const args = buildSourceLivePipInputArgs("rtsp://reader:key@relay:8554/src-front-desk");
    expect(args).not.toContain("-re");
    expect(args).not.toContain("-stream_loop");
    expect(args).not.toContain("-reconnect");
  });

  it("keeps the RTSP timeout strictly under the smallest duration-bound margin the watchdog allows", () => {
    // The whole point of the 4 s ceiling: a source that never opens gives up well inside the
    // smallest configurable duration-bound margin, so a slow PiP connect can never be what trips
    // the duration bound. If either number moves, this invariant must be re-proven.
    expect(SOURCE_LIVE_RTSP_TIMEOUT_US).toBe(4_000_000);
    expect(SOURCE_LIVE_RTSP_TIMEOUT_US).toBeLessThan(WATCHDOG_LIMITS.durationBoundMarginSeconds.min * 1_000_000);
  });
});

describe("live-attached source filter graph (M57 stage 2, Etappes C/D)", () => {
  const box = { left: 1152, top: 120, width: 512, height: 288 };

  it("scales the source to cover its box, resets pts, and lays it UNDER the scene PNG", () => {
    const { filterComplex } = buildSourceLivePipFilterComplex({
      outputVideoFilter: "scale=1920:1080,setsar=1",
      sceneInputIndex: 2,
      pipInputIndex: 3,
      fps: 30,
      box,
      audio: null
    });
    expect(filterComplex).toBe(
      "[0:v]scale=1920:1080,setsar=1[base];" +
        "[3:v]fps=30,scale=512:288:force_original_aspect_ratio=increase,crop=512:288,setpts=PTS-STARTPTS[pipv];" +
        "[base][pipv]overlay=1152:120:eof_action=pass[vpip];" +
        "[vpip][2:v]overlay=0:0:format=auto[vout]"
    );
  });

  it("reads the raw program video when output scaling is off", () => {
    const { filterComplex } = buildSourceLivePipFilterComplex({
      outputVideoFilter: "",
      sceneInputIndex: 1,
      pipInputIndex: 2,
      fps: 25,
      box,
      audio: null
    });
    expect(filterComplex.startsWith("[2:v]fps=25,")).toBe(true);
    expect(filterComplex).toContain("[0:v][pipv]overlay=1152:120:eof_action=pass[vpip]");
    expect(filterComplex.endsWith("[vpip][1:v]overlay=0:0:format=auto[vout]")).toBe(true);
    expect(filterComplex).not.toContain("[base]");
  });

  it("overlays the ended source with eof_action=pass so a lost feed never freezes the frame", () => {
    const { filterComplex } = buildSourceLivePipFilterComplex({
      outputVideoFilter: "scale=1280:720",
      sceneInputIndex: 2,
      pipInputIndex: 3,
      fps: 30,
      box,
      audio: null
    });
    expect(filterComplex).toContain("overlay=1152:120:eof_action=pass");
  });

  it("does not map audio when the source carries none", () => {
    const parts = buildSourceLivePipFilterComplex({
      outputVideoFilter: "scale=1920:1080",
      sceneInputIndex: 2,
      pipInputIndex: 3,
      fps: 30,
      box,
      audio: null
    });
    expect(parts.audioMapped).toBe(false);
    expect(parts.filterComplex).not.toContain("amix");
    expect(parts.filterComplex).not.toContain("[aout]");
  });

  it("mixes programme/lane audio FIRST at duration=first with normalize=0 and no apad", () => {
    const parts = buildSourceLivePipFilterComplex({
      outputVideoFilter: "scale=1920:1080",
      sceneInputIndex: 2,
      pipInputIndex: 3,
      fps: 30,
      box,
      audio: { programLabel: "[1:a]", programVolume: 0.8, sourceGain: 0.4 }
    });
    expect(parts.audioMapped).toBe(true);
    const audio = parts.filterComplex.slice(parts.filterComplex.indexOf("[vout]") + "[vout]".length + 1);
    expect(audio).toBe(
      "[1:a]volume=0.800[prog_a];" +
        "[3:a]aresample=async=1:first_pts=0,volume=0.400[pip_a];" +
        "[prog_a][pip_a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]"
    );
    // The three pins the plan calls out, asserted directly against the emitted graph.
    expect(audio).toContain("normalize=0");
    expect(audio).toContain("duration=first");
    expect(audio.indexOf("[prog_a]")).toBeLessThan(audio.indexOf("[pip_a]"));
    expect(audio.indexOf("[prog_a][pip_a]amix")).toBeGreaterThan(-1);
    expect(audio).not.toContain("apad");
  });

  it("reads programme audio directly ([0:a]) when there is no audio lane", () => {
    const parts = buildSourceLivePipFilterComplex({
      outputVideoFilter: "scale=1920:1080",
      sceneInputIndex: 1,
      pipInputIndex: 2,
      fps: 30,
      box,
      audio: { programLabel: "[0:a]", programVolume: 1, sourceGain: 0.4 }
    });
    expect(parts.filterComplex).toContain("[0:a]volume=1.000[prog_a];");
    expect(parts.filterComplex).toContain("[2:a]aresample=async=1:first_pts=0,volume=0.400[pip_a];");
  });

  it("clamps the source gain into 0..2 (200%) and formats it like the lane volume", () => {
    const loud = buildSourceLivePipFilterComplex({
      outputVideoFilter: "",
      sceneInputIndex: 1,
      pipInputIndex: 2,
      fps: 30,
      box,
      audio: { programLabel: "[0:a]", programVolume: 1, sourceGain: 5 }
    });
    expect(loud.filterComplex).toContain("volume=2.000[pip_a]");
    const negative = buildSourceLivePipFilterComplex({
      outputVideoFilter: "",
      sceneInputIndex: 1,
      pipInputIndex: 2,
      fps: 30,
      box,
      audio: { programLabel: "[0:a]", programVolume: 1, sourceGain: -1 }
    });
    expect(negative.filterComplex).toContain("volume=0.000[pip_a]");
  });
});

describe("live-source audio decision (M57 stage 2, Etappe D + review)", () => {
  const base = {
    programDurationSeconds: 1800,
    sourceAudioConfirmed: true,
    hasAudioLane: false,
    laneVolumePercent: 80,
    programAudioConfirmed: true,
    sourceGainPercent: 40
  };

  it("refuses to mix when the programme has no known finite duration (feed-audio watchdog stays the net)", () => {
    // This is the blocker fix: an unknown-duration programme keeps its own audio as the sole track,
    // so a silent-but-still-running source is caught by the feed-audio watchdog instead of masked by
    // live PiP sound. Zero, negative, NaN and Infinity all read as unknown.
    for (const durationSeconds of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(decideLiveSourceAudio({ ...base, programDurationSeconds: durationSeconds })).toBeNull();
    }
  });

  it("refuses to mix when the source's audio is not probe-confirmed, whatever the relay advised", () => {
    // The TOCTOU fix: referencing [L:a] on a source that has no audio crashes ffmpeg at graph init,
    // so an unconfirmed source is video-only regardless of the advisory track flag.
    expect(decideLiveSourceAudio({ ...base, sourceAudioConfirmed: false })).toBeNull();
  });

  it("mixes lane audio first at its lane volume for a known-duration programme", () => {
    expect(decideLiveSourceAudio({ ...base, hasAudioLane: true, laneVolumePercent: 80 })).toEqual({
      programLabel: "[1:a]",
      programVolume: 0.8,
      sourceGain: 0.4
    });
  });

  it("mixes programme audio (identity level) when there is no lane and the programme audio is confirmed", () => {
    expect(decideLiveSourceAudio(base)).toEqual({ programLabel: "[0:a]", programVolume: 1, sourceGain: 0.4 });
  });

  it("stays video-only when there is no lane and the programme has no confirmed audio", () => {
    expect(decideLiveSourceAudio({ ...base, programAudioConfirmed: false })).toBeNull();
  });
});
