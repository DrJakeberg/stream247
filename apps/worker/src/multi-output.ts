import { selectActiveDestinationGroup, type DestinationRoutingRecord } from "@stream247/core";
import type { StreamDestinationRecord } from "@stream247/db";

export type DestinationRuntimeTarget = {
  destination: StreamDestinationRecord;
  target: string;
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

export function buildFfmpegOutputTarget(targets: DestinationRuntimeTarget[]): {
  muxer: "flv" | "tee";
  output: string;
} {
  if (targets.length === 0) {
    return {
      muxer: "flv",
      output: ""
    };
  }

  if (targets.length === 1) {
    return {
      muxer: "flv",
      output: targets[0]!.target
    };
  }

  return {
    muxer: "tee",
    output: targets.map((entry) => `[onfail=ignore:f=flv:use_fifo=1]${entry.target}`).join("|")
  };
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

export function matchDestinationFailuresInLog(line: string, targets: DestinationRuntimeTarget[]): string[] {
  const sample = line.toLowerCase();
  const matchedIds = targets
    .filter((entry) => buildDestinationErrorNeedles(entry.destination).some((needle) => sample.includes(needle)))
    .map((entry) => entry.destination.id);

  if (matchedIds.length > 0) {
    return [...new Set(matchedIds)];
  }

  return targets.length === 1 ? [targets[0]!.destination.id] : [];
}
