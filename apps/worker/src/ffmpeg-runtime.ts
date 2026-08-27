import path from "node:path";
import {
  resolveEncoderQualitySettings,
  resolvePlayoutReconnectTuning,
  resolveProgramFeedTuning,
  type ManagedEncoderQualityInput,
  type ManagedFeedTuningInput,
  type StreamOutputSettings
} from "@stream247/core";
import { getOutputGopSize, getOutputVideoFilter, isStreamScaleEnabled } from "./output-settings.js";

const OUTPUT_FAILURE_NEEDLES = [
  "broken pipe",
  "connection refused",
  "connection reset",
  "error writing trailer",
  "input/output error",
  "i/o error",
  "av_interleaved_write_frame",
  "server returned 4",
  "server returned 5"
];

const NON_DESTINATION_NEEDLES = [
  "resumed reading at pts",
  "failed to update header with correct duration",
  "failed to update header with correct filesize",
  "error during demuxing"
];

const PROGRAM_FEED_INPUT_NEEDLES = [
  "error opening input",
  "failed to open segment",
  "failed to reload playlist",
  "error when loading first segment",
  "no such file or directory",
  "end of file",
  "invalid data found when processing input",
  "error during demuxing"
];

function isRemoteHttpInput(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type FfmpegOutputTarget = {
  muxer: "flv" | "tee" | "hls";
  output: string;
  outputArgs?: string[];
};

export type UplinkInputMode = "hls" | "rtmp";

export type ProgramFeedConfig = {
  directory: string;
  playlistPath: string;
  segmentPattern: string;
  targetSeconds: number;
  listSize: number;
  bufferedSeconds: number;
  failoverSeconds: number;
};

/** M56 part 2: managed cadence first (clamped in core), env second, 48h/20s default last. */
export function getPlayoutReconnectConfig(
  env: NodeJS.ProcessEnv = process.env,
  managed?: ManagedFeedTuningInput
): {
  intervalHours: number;
  intervalMs: number;
  windowSeconds: number;
  windowMs: number;
} {
  const tuning = resolvePlayoutReconnectTuning(managed ?? null, env);

  return {
    intervalHours: tuning.intervalHours,
    intervalMs: tuning.intervalHours * 60 * 60 * 1000,
    windowSeconds: tuning.windowSeconds,
    windowMs: tuning.windowSeconds * 1000
  };
}

export function isRelayModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STREAM247_RELAY_ENABLED === "1";
}

export function getUplinkInputMode(env: NodeJS.ProcessEnv = process.env): UplinkInputMode {
  return env.STREAM247_UPLINK_INPUT_MODE === "rtmp" ? "rtmp" : "hls";
}

export function getRelayPublishUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.STREAM247_RELAY_OUTPUT_URL || "rtmp://relay:1935/live/program";
}

export function getRelayInputUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.STREAM247_RELAY_INPUT_URL || getRelayPublishUrl(env);
}

/**
 * M56 part 2: the feed geometry (segment length, window size, failover margin) resolves managed
 * first through the shared core clamps. The directory stays env-only — where the feed lives on
 * disk is infrastructure, decided by the mount layout, not an operating decision.
 */
export function getProgramFeedConfig(
  env: NodeJS.ProcessEnv = process.env,
  mediaRoot = "/app/data/media",
  managed?: ManagedFeedTuningInput
): ProgramFeedConfig {
  const directory = env.STREAM247_PROGRAM_FEED_DIR || path.join(mediaRoot, ".stream247-program-feed");
  const tuning = resolveProgramFeedTuning(managed ?? null, env);

  return {
    directory,
    playlistPath: path.join(directory, "program.m3u8"),
    segmentPattern: path.join(directory, "segment-%s-%05d.ts"),
    targetSeconds: tuning.targetSeconds,
    listSize: tuning.listSize,
    bufferedSeconds: tuning.targetSeconds * tuning.listSize,
    failoverSeconds: tuning.failoverSeconds
  };
}

export function buildProgramFeedOutputTarget(config: ProgramFeedConfig, runId: string): FfmpegOutputTarget {
  // MEDIA-SEQUENCE continuity is load-bearing for the persistent uplink: with append_list the
  // muxer continues numbering from the existing playlist, so the uplink's HLS demuxer reads
  // across playout asset boundaries without interruption. Setting -hls_start_number_source
  // (e.g. epoch_us) instead restarts the sequence at each playout run, which the uplink demuxer
  // sees as a huge forward jump ("skipping N segments ahead, expired from playlists"), hits EOF,
  // and dies on every asset boundary (the v1.5.15 soak failure: one unplanned uplink restart per
  // boundary until destination=degraded). Boundary timestamp resets are signaled via
  // discont_start and absorbed by ffmpeg's input discontinuity correction (dts_delta_threshold);
  // per-run segment uniqueness comes from the runId embedded in the segment filename.
  return {
    muxer: "hls",
    output: config.playlistPath,
    outputArgs: [
      "-hls_time",
      String(config.targetSeconds),
      "-hls_list_size",
      String(config.listSize),
      "-hls_flags",
      "append_list+delete_segments+program_date_time+independent_segments+omit_endlist+temp_file+discont_start",
      "-hls_segment_filename",
      config.segmentPattern.replace("%s", runId)
    ]
  };
}

export function appendFfmpegOutputArgs(command: string[], outputTarget: FfmpegOutputTarget): void {
  command.push(...(outputTarget.outputArgs ?? []), "-f", outputTarget.muxer, outputTarget.output);
}

function appendTeeStreamMaps(command: string[]): void {
  command.push("-map", "0:v:0", "-map", "0:a:0?");
}

export function isNaturalPlayoutBoundary(args: {
  targetKind: "asset" | "insert" | "standby" | "reconnect" | "live" | "";
  code: number | null;
  signal: NodeJS.Signals | null;
}): boolean {
  return (args.targetKind === "asset" || args.targetKind === "insert") && args.code === 0 && !args.signal;
}

export function shouldRequestImmediatePlayoutRetry(args: {
  planned: boolean;
  naturalBoundary?: boolean;
  crashLoopDetected: boolean;
}): boolean {
  if (args.crashLoopDetected) {
    return false;
  }

  if (args.planned) {
    return false;
  }

  if (args.naturalBoundary) {
    return true;
  }

  return true;
}

export function shouldSkipInitialSceneCapture(args: {
  overlayEnabled: boolean;
  switching: boolean;
  playoutStatus: string;
  lastExitCode: string;
  heartbeatAt: string;
  nowMs?: number;
  windowMs?: number;
}): boolean {
  if (!args.overlayEnabled || args.switching || !args.lastExitCode || !args.heartbeatAt) {
    return false;
  }

  if (args.playoutStatus !== "failed" && args.playoutStatus !== "idle" && args.playoutStatus !== "recovering") {
    return false;
  }

  const heartbeatMs = new Date(args.heartbeatAt).getTime();
  if (!Number.isFinite(heartbeatMs)) {
    return false;
  }

  return (args.nowMs ?? Date.now()) - heartbeatMs <= (args.windowMs ?? 60_000);
}

export function buildFfmpegInputArgs(args: {
  input: string;
  realtime?: boolean;
  loop?: boolean;
}): string[] {
  const command: string[] = [];

  if (args.loop) {
    command.push("-stream_loop", "-1");
  }

  if (args.realtime) {
    command.push("-re");
  }

  if (isRemoteHttpInput(args.input)) {
    command.push(
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_on_network_error",
      "1",
      "-reconnect_delay_max",
      process.env.FFMPEG_RECONNECT_DELAY_MAX || "10"
    );
  }

  command.push("-i", args.input);
  return command;
}

// --- Live-attached source (PiP) input + filter graph (M57 stage 2, Etappes C/D) --------------

/**
 * The RTSP socket timeout for a live-attached source, in microseconds (ffmpeg's rtsp demuxer
 * unit). 4 s on purpose: a source that never opens must give up well inside the smallest
 * duration-bound margin the watchdog can be configured to
 * (WATCHDOG_LIMITS.durationBoundMarginSeconds.min, 5 s), so a slow PiP connect can never be what
 * trips the duration bound. See the clamp-invariant test in ffmpeg-runtime.test.ts.
 */
export const SOURCE_LIVE_RTSP_TIMEOUT_US = 4_000_000;

/**
 * Input arguments for the live PiP source: RTSP pinned to TCP (UDP loses packets silently across
 * container networks — the snapshot sampler pins TCP for the same reason) with the bounded socket
 * timeout. No -re: the feed is already realtime. No loop and no reconnect: a source that drops is
 * meant to fall away (amix drops the ended input), not to hold the encode open.
 */
export function buildSourceLivePipInputArgs(url: string): string[] {
  return ["-rtsp_transport", "tcp", "-timeout", String(SOURCE_LIVE_RTSP_TIMEOUT_US), "-i", url];
}

/** A gain/volume fraction, clamped to [min, max] and formatted the way the audio-lane filter is. */
function formatGain(fraction: number, max: number): string {
  return Math.max(0, Math.min(max, Number.isFinite(fraction) ? fraction : 0)).toFixed(3);
}

export type SourceLivePipAudio = {
  /** "[1:a]" for the audio lane, "[0:a]" for programme audio: the mix's FIRST input. */
  programLabel: string;
  /** Programme/lane level as a fraction (lane volume, or 1 for untouched programme). */
  programVolume: number;
  /** Live source gain as a fraction (resolveSourceLiveGainPercent / 100), clamped 0..2. */
  sourceGain: number;
};

export type SourceLivePipCommandParts = {
  /** The whole -filter_complex value: video always, audio only when `audio` was supplied. */
  filterComplex: string;
  /** True when the graph produced [aout]; the caller maps it instead of the legacy audio map. */
  audioMapped: boolean;
};

/**
 * The video (and, when the source carries sound, audio) filter graph for a live-attached PiP,
 * for scene overlay mode. The PiP input is always the LAST ffmpeg input, so the scene pipe keeps
 * its existing index and the caller passes both indices in rather than this builder guessing them.
 *
 * Video: the source is scaled to cover its placement box and cropped to it (matching the sampled
 * panel's object-fit), timestamps reset, then overlaid UNDER the scene PNG — eof_action=pass so a
 * source that ends leaves the programme frame untouched instead of freezing or blanking it.
 *
 * Audio: the programme/lane audio is the FIRST amix input at duration=first, so the mix ends with
 * the programme and never outlives it; normalize=0 keeps the programme's level from jumping when
 * the source drops out; the PiP branch is resampled (async) and gained but carries NO apad, so a
 * source that ends is simply dropped by amix rather than padded into endless masking silence.
 */
export function buildSourceLivePipFilterComplex(args: {
  outputVideoFilter: string;
  sceneInputIndex: number;
  pipInputIndex: number;
  fps: number;
  box: { left: number; top: number; width: number; height: number };
  audio: SourceLivePipAudio | null;
}): SourceLivePipCommandParts {
  const { box, pipInputIndex: pip, sceneInputIndex: scene, fps } = args;
  const baseChain = args.outputVideoFilter ? `[0:v]${args.outputVideoFilter}[base];` : "";
  const baseLabel = args.outputVideoFilter ? "[base]" : "[0:v]";

  const video =
    `${baseChain}` +
    `[${pip}:v]fps=${fps},scale=${box.width}:${box.height}:force_original_aspect_ratio=increase,` +
    `crop=${box.width}:${box.height},setpts=PTS-STARTPTS[pipv];` +
    `${baseLabel}[pipv]overlay=${box.left}:${box.top}:eof_action=pass[vpip];` +
    `[vpip][${scene}:v]overlay=0:0:format=auto[vout]`;

  if (!args.audio) {
    return { filterComplex: video, audioMapped: false };
  }

  const audio =
    `${args.audio.programLabel}volume=${formatGain(args.audio.programVolume, 1)}[prog_a];` +
    `[${pip}:a]aresample=async=1:first_pts=0,volume=${formatGain(args.audio.sourceGain, 2)}[pip_a];` +
    `[prog_a][pip_a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`;

  return { filterComplex: `${video};${audio}`, audioMapped: true };
}

export type LiveSourceAudioDecisionInput = {
  /** The programme asset's known duration in seconds; <= 0 or non-finite means unknown. */
  programDurationSeconds: number;
  /**
   * Whether the live source actually carries an audio stream — the PROBED verdict, never the relay's
   * advisory track flag alone. Referencing `[L:a]` when the source has no audio makes ffmpeg abort at
   * graph init ("matches no streams"), so the caller must confirm the stream before mixing it.
   */
  sourceAudioConfirmed: boolean;
  /** An audio lane replaces the programme's own audio; a looped audio asset always carries sound. */
  hasAudioLane: boolean;
  laneVolumePercent: number;
  /** Whether the resolved programme input carries audio — the probed verdict; unused with a lane. */
  programAudioConfirmed: boolean;
  /** resolveSourceLiveGainPercent (0..200); the graph builder clamps and formats it. */
  sourceGainPercent: number;
};

/**
 * Whether — and how — the live source's audio may be folded into the programme mix.
 *
 * The feed-audio watchdog (feed-audio-health.ts) reads the programme's own audio out of the muxed
 * HLS segment to catch a source that runs dry WITHOUT delivering EOF: the fps filter keeps inventing
 * video from the last frame, so video packets are worthless as a liveness signal and audio is the
 * honest one. Folding live PiP audio into that segment would mask a silent programme behind the PiP's
 * sound — the watchdog would see audio packets and never fire, and the channel could sit indefinitely
 * on a frozen programme picture with live PiP audio.
 *
 * So the mix is built ONLY when the programme has a KNOWN finite duration: duration-bound
 * (duration-bound.ts) then ends the asset once it plays past its duration, making the masking
 * harmless. An unknown-duration programme keeps its own audio as the sole track, so the feed-audio
 * watchdog stays the honest net it exists to be. Returns null → attach video-only, never blocked.
 */
export function decideLiveSourceAudio(input: LiveSourceAudioDecisionInput): SourceLivePipAudio | null {
  if (!(Number.isFinite(input.programDurationSeconds) && input.programDurationSeconds > 0)) {
    return null;
  }
  if (!input.sourceAudioConfirmed) {
    return null;
  }
  const sourceGain = input.sourceGainPercent / 100;
  if (input.hasAudioLane) {
    return { programLabel: "[1:a]", programVolume: input.laneVolumePercent / 100, sourceGain };
  }
  if (input.programAudioConfirmed) {
    return { programLabel: "[0:a]", programVolume: 1, sourceGain };
  }
  return null;
}

export function isLikelyDestinationOutputError(line: string): boolean {
  const sample = line.toLowerCase();

  if (NON_DESTINATION_NEEDLES.some((token) => sample.includes(token))) {
    return false;
  }

  return OUTPUT_FAILURE_NEEDLES.some((token) => sample.includes(token));
}

export function isLikelyProgramFeedInputError(line: string): boolean {
  const sample = line.toLowerCase();
  return PROGRAM_FEED_INPUT_NEEDLES.some((token) => sample.includes(token));
}

export function describeFfmpegExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (typeof code === "number") {
    return `exited with code ${String(code)}`;
  }

  if (signal) {
    return `was terminated by signal ${signal}`;
  }

  return "exited unexpectedly";
}

function getOutputRateControlSettings(
  output: StreamOutputSettings | null,
  env: NodeJS.ProcessEnv,
  managedConfig: ManagedEncoderQualityInput
): {
  maxrate: string;
  bufsize: string;
  audioBitrate: string;
} {
  // An explicitly configured rate trio — managed config or env, resolved by the shared core
  // resolver — beats the resolution ladder below, exactly like the old "any FFMPEG_* rate env
  // set" check did.
  const encoder = resolveEncoderQualitySettings(managedConfig, env);
  if (encoder.rateControlConfigured) {
    return {
      maxrate: encoder.maxrate,
      bufsize: encoder.bufsize,
      audioBitrate: encoder.audioBitrate
    };
  }

  if (!output) {
    return {
      maxrate: "4500k",
      bufsize: "9000k",
      audioBitrate: "160k"
    };
  }

  if (output.height >= 1080 || output.width >= 1920) {
    return {
      maxrate: "6000k",
      bufsize: "12000k",
      audioBitrate: "160k"
    };
  }

  if (output.height >= 720 || output.width >= 1280) {
    return {
      maxrate: "4500k",
      bufsize: "9000k",
      audioBitrate: "160k"
    };
  }

  if (output.height >= 480 || output.width >= 854) {
    return {
      maxrate: "2500k",
      bufsize: "5000k",
      audioBitrate: "160k"
    };
  }

  return {
    maxrate: "1200k",
    bufsize: "2400k",
    audioBitrate: "160k"
  };
}

export function buildUplinkFfmpegCommand(
  input: string,
  outputTarget: FfmpegOutputTarget,
  options: {
    inputMode?: UplinkInputMode;
    env?: NodeJS.ProcessEnv;
    outputSettings?: StreamOutputSettings | null;
    managedConfig?: ManagedEncoderQualityInput;
  } = {}
): string[] {
  const inputMode = options.inputMode ?? "rtmp";
  const env = options.env ?? process.env;
  const outputSettings = options.outputSettings ?? null;
  const managedConfig = options.managedConfig ?? null;
  const command = [
    "-hide_banner",
    "-loglevel",
    "warning",
    // Machine-readable progress on the otherwise unused stdout. This is the only signal that
    // distinguishes an uplink that is running from one that is working: the supervisor watches
    // out_time here, because a stalled ffmpeg stays alive and looks healthy from the outside.
    "-progress",
    "pipe:1",
    "-nostats",
    "-fflags",
    inputMode === "hls" ? "+genpts+discardcorrupt" : "+genpts"
  ];

  if (inputMode === "hls") {
    command.push("-err_detect", "ignore_err", "-max_reload", "10", "-m3u8_hold_counters", "1200");
  }

  command.push("-i", input);

  if (inputMode === "rtmp" && !outputSettings) {
    command.push("-c", "copy");
    if (outputTarget.muxer === "tee") {
      appendTeeStreamMaps(command);
    }
    appendFfmpegOutputArgs(command, outputTarget);
    return command;
  }

  const outputVideoFilter = outputSettings && isStreamScaleEnabled(env) ? getOutputVideoFilter(outputSettings) : "";
  if (outputVideoFilter) {
    command.push("-vf", outputVideoFilter);
  }
  const rateControl = getOutputRateControlSettings(outputSettings, env, managedConfig);

  command.push(
    "-c:v",
    "libx264",
    "-preset",
    resolveEncoderQualitySettings(managedConfig, env).preset,
    "-maxrate",
    rateControl.maxrate,
    "-bufsize",
    rateControl.bufsize,
    "-pix_fmt",
    "yuv420p",
    "-g",
    outputSettings ? getOutputGopSize(outputSettings) : "60",
    "-tune",
    "zerolatency",
    "-bf",
    "0",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    rateControl.audioBitrate
  );
  if (outputTarget.muxer === "tee") {
    appendTeeStreamMaps(command);
  }
  appendFfmpegOutputArgs(command, outputTarget);
  return command;
}
