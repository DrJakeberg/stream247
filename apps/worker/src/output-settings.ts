import {
  resolveStreamOutputSettings,
  type StreamOutputSettings
} from "@stream247/core";
import type { OutputSettingsRecord } from "@stream247/db";

export type WorkerStreamOutputSettings = StreamOutputSettings;

export function getWorkerStreamOutputSettings(
  env: NodeJS.ProcessEnv,
  settings?: OutputSettingsRecord | null
): WorkerStreamOutputSettings {
  return resolveStreamOutputSettings({ settings, env });
}

export function isStreamScaleEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.STREAM_SCALE_ENABLED !== "0";
}

export function getOutputVideoFilter(output: StreamOutputSettings): string {
  return [
    `scale=${output.width}:${output.height}:force_original_aspect_ratio=decrease`,
    `pad=${output.width}:${output.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=${output.fps}`,
    "setsar=1"
  ].join(",");
}

export function getOutputScaleFactor(output: StreamOutputSettings): number {
  return Math.min(1, Math.max(0.62, output.height / 720));
}

export function getOutputGopSize(output: StreamOutputSettings): string {
  return String(Math.max(1, Math.round(output.fps * 2)));
}
