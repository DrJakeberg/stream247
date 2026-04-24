import {
  normalizeDestinationOutputProfileId,
  resolveDestinationOutputSettings,
  selectActiveDestinationGroup,
  type DestinationOutputProfileId,
  type DestinationRoutingRecord,
  type StreamOutputSettings
} from "@stream247/core";
import type { OutputSettingsRecord, StreamDestinationRecord } from "@stream247/db";
import type { FfmpegOutputTarget } from "./ffmpeg-runtime.js";

export type DestinationRuntimeTarget = {
  destination: StreamDestinationRecord;
  target: string;
};

export type DestinationRuntimeTargetGroup = {
  key: string;
  label: string;
  profileId: DestinationOutputProfileId;
  settings: StreamOutputSettings;
  targets: DestinationRuntimeTarget[];
  leadDestination: StreamDestinationRecord | null;
};

export function getLegacyDestinationEnvConfig(
  destinationId: string,
  env: NodeJS.ProcessEnv
): { url: string; key: string } {
  if (destinationId === "destination-backup") {
    return {
      url: env.BACKUP_STREAM_OUTPUT_URL || env.BACKUP_TWITCH_RTMP_URL || "",
      key: env.BACKUP_STREAM_OUTPUT_KEY || env.BACKUP_TWITCH_STREAM_KEY || ""
    };
  }

  if (destinationId === "destination-primary") {
    return {
      url: env.STREAM_OUTPUT_URL || env.TWITCH_RTMP_URL || "",
      key: env.STREAM_OUTPUT_KEY || env.TWITCH_STREAM_KEY || ""
    };
  }

  return {
    url: "",
    key: ""
  };
}

export function resolveDestinationStreamTarget(args: {
  destination: StreamDestinationRecord;
  managedKeys: Record<string, string>;
  env: NodeJS.ProcessEnv;
}): string | null {
  if (!args.destination.enabled) {
    return null;
  }

  const managedKey = args.managedKeys[args.destination.id] || "";
  const envFallback = getLegacyDestinationEnvConfig(args.destination.id, args.env);
  const streamUrl = args.destination.rtmpUrl || envFallback.url;
  const streamKey = managedKey || envFallback.key;

  if (!streamUrl || !streamKey) {
    return null;
  }

  return `${streamUrl.replace(/\/$/, "")}/${streamKey}`;
}

export function selectDestinationRuntimeTargets(args: {
  destinations: StreamDestinationRecord[];
  managedKeys: Record<string, string>;
  env: NodeJS.ProcessEnv;
}): {
  mode: "primary" | "backup" | "none";
  targets: DestinationRuntimeTarget[];
  leadDestination: StreamDestinationRecord | null;
} {
  const activeGroup = selectActiveDestinationGroup(
    args.destinations.map(
      (destination): DestinationRoutingRecord => ({
        id: destination.id,
        name: destination.name,
        role: destination.role,
        priority: destination.priority,
        enabled: destination.enabled,
        streamKeyPresent: destination.streamKeyPresent,
        status: destination.status
      })
    )
  );

  const targets = activeGroup.activeDestinationIds
    .map((id) => args.destinations.find((destination) => destination.id === id) ?? null)
    .filter((destination): destination is StreamDestinationRecord => Boolean(destination))
    .map((destination) => ({
      destination,
      target: resolveDestinationStreamTarget({
        destination,
        managedKeys: args.managedKeys,
        env: args.env
      })
    }))
    .filter((entry): entry is DestinationRuntimeTarget => Boolean(entry.target));

  return {
    mode: activeGroup.mode,
    targets,
    leadDestination: targets[0]?.destination ?? null
  };
}

export function buildFfmpegOutputTarget(targets: DestinationRuntimeTarget[]): FfmpegOutputTarget {
  if (targets.length === 0) {
    return {
      muxer: "flv",
      output: ""
    };
  }

  return {
    muxer: "tee",
    output: targets.map((entry) => `${buildTeeOutputOptions(entry.target)}${entry.target}`).join("|")
  };
}

export function buildOutputSettingsKey(settings: StreamOutputSettings): string {
  return `${settings.width}x${settings.height}@${settings.fps}`;
}

export function groupDestinationRuntimeTargetsByOutputProfile(args: {
  targets: DestinationRuntimeTarget[];
  streamOutput: OutputSettingsRecord;
  env: NodeJS.ProcessEnv;
}): DestinationRuntimeTargetGroup[] {
  const groups = new Map<string, DestinationRuntimeTargetGroup>();

  for (const entry of args.targets) {
    const profileId = normalizeDestinationOutputProfileId(entry.destination.outputProfileId);
    const settings = resolveDestinationOutputSettings({
      destinationProfileId: profileId,
      streamSettings: args.streamOutput,
      env: args.env
    });
    const key = buildOutputSettingsKey(settings);
    const existing = groups.get(key);

    if (existing) {
      existing.targets.push(entry);
      if (!existing.leadDestination) {
        existing.leadDestination = entry.destination;
      }
      continue;
    }

    groups.set(key, {
      key,
      label: `${settings.width}x${settings.height}@${settings.fps}`,
      profileId,
      settings,
      targets: [entry],
      leadDestination: entry.destination
    });
  }

  return [...groups.values()];
}

function buildTeeOutputOptions(target: string): string {
  const options = [
    "onfail=ignore",
    "f=flv",
    "use_fifo=1",
    "fifo_options=attempt_recovery=1\\\\:recover_any_error=1\\\\:recovery_wait_time=1"
  ];
  if (isLocalFileOutputTarget(target)) {
    options.push("flush_packets=1");
  }
  return `[${options.join(":")}]`;
}

function isLocalFileOutputTarget(target: string): boolean {
  const normalizedTarget = target.trim();
  return (
    normalizedTarget.startsWith("/") ||
    normalizedTarget.startsWith("./") ||
    normalizedTarget.startsWith("../") ||
    normalizedTarget.startsWith("file:")
  );
}

function buildDestinationErrorNeedles(destination: StreamDestinationRecord): string[] {
  const needles = [destination.rtmpUrl];

  try {
    const url = new URL(destination.rtmpUrl);
    needles.push(url.host, url.hostname);
  } catch {
    // ignore parse failures for non-standard RTMP strings
  }

  return needles.filter(Boolean).map((entry) => entry.toLowerCase());
}

export function matchDestinationFailuresInLog(
  line: string,
  targets: DestinationRuntimeTarget[],
  options: { allowSingleTargetFallback?: boolean } = {}
): string[] {
  const sample = line.toLowerCase();
  const matchedIds = targets
    .filter((entry) => buildDestinationErrorNeedles(entry.destination).some((needle) => sample.includes(needle)))
    .map((entry) => entry.destination.id);

  if (matchedIds.length > 0) {
    return [...new Set(matchedIds)];
  }

  return options.allowSingleTargetFallback !== false && targets.length === 1 ? [targets[0]!.destination.id] : [];
}
