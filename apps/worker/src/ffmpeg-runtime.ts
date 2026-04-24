import path from "node:path";
import type { StreamOutputSettings } from "@stream247/core";
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

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

export function getPlayoutReconnectConfig(env: NodeJS.ProcessEnv = process.env): {
  intervalHours: number;
  intervalMs: number;
  windowSeconds: number;
  windowMs: number;
} {
  const intervalHours = readPositiveNumber(env.PLAYOUT_RECONNECT_HOURS, 48);
  const windowSeconds = readPositiveNumber(env.PLAYOUT_RECONNECT_SECONDS, 20);

  return {
    intervalHours,
    intervalMs: intervalHours * 60 * 60 * 1000,
    windowSeconds,
    windowMs: windowSeconds * 1000
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

export function getProgramFeedConfig(
  env: NodeJS.ProcessEnv = process.env,
  mediaRoot = "/app/data/media"
): ProgramFeedConfig {
  const directory = env.STREAM247_PROGRAM_FEED_DIR || path.join(mediaRoot, ".stream247-program-feed");
  const targetSeconds = Math.max(1, Math.floor(readPositiveNumber(env.STREAM247_PROGRAM_FEED_TARGET_SECONDS, 2)));
  const listSize = Math.max(3, Math.floor(readPositiveNumber(env.STREAM247_PROGRAM_FEED_LIST_SIZE, 30)));
  const failoverSeconds = Math.max(1, Math.floor(readPositiveNumber(env.STREAM247_PROGRAM_FEED_FAILOVER_SECONDS, 10)));

  return {
    directory,
    playlistPath: path.join(directory, "program.m3u8"),
    segmentPattern: path.join(directory, "segment-%s-%05d.ts"),
    targetSeconds,
    listSize,
    bufferedSeconds: targetSeconds * listSize,
    failoverSeconds
  };
}

export function buildProgramFeedOutputTarget(config: ProgramFeedConfig, runId: string): FfmpegOutputTarget {
  return {
    muxer: "hls",
    output: config.playlistPath,
    outputArgs: [
      "-hls_time",
      String(config.targetSeconds),
      "-hls_list_size",
      String(config.listSize),
      "-hls_start_number_source",
      "epoch_us",
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

function getOutputRateControlSettings(output: StreamOutputSettings | null, env: NodeJS.ProcessEnv): {
  maxrate: string;
  bufsize: string;
  audioBitrate: string;
} {
  if (env.FFMPEG_MAXRATE || env.FFMPEG_BUFSIZE || env.FFMPEG_AUDIO_BITRATE) {
    return {
      maxrate: env.FFMPEG_MAXRATE || "4500k",
      bufsize: env.FFMPEG_BUFSIZE || "9000k",
      audioBitrate: env.FFMPEG_AUDIO_BITRATE || "160k"
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
  options: { inputMode?: UplinkInputMode; env?: NodeJS.ProcessEnv; outputSettings?: StreamOutputSettings | null } = {}
): string[] {
  const inputMode = options.inputMode ?? "rtmp";
  const env = options.env ?? process.env;
  const outputSettings = options.outputSettings ?? null;
  const command = [
    "-hide_banner",
    "-loglevel",
    "warning",
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
  const rateControl = getOutputRateControlSettings(outputSettings, env);

  command.push(
    "-c:v",
    "libx264",
    "-preset",
    env.FFMPEG_PRESET || "veryfast",
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
