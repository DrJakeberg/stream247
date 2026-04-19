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

export function shouldRequestImmediatePlayoutRetry(args: { planned: boolean; crashLoopDetected: boolean }): boolean {
  return !args.planned && !args.crashLoopDetected;
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

export function describeFfmpegExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (typeof code === "number") {
    return `exited with code ${String(code)}`;
  }

  if (signal) {
    return `was terminated by signal ${signal}`;
  }

  return "exited unexpectedly";
}
