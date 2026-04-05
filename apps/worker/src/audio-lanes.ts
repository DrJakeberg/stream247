import { normalizeAudioLaneVolumePercent } from "@stream247/core";
import type { AppState, AssetRecord } from "@stream247/db";

export type ResolvedAudioLane = {
  asset: AssetRecord;
  volumePercent: number;
  poolId: string;
  poolName: string;
};

export function shouldUsePoolAudioLane(args: {
  queueKind: AppState["playout"]["queueItems"][number]["kind"];
  reasonCode: AppState["playout"]["selectionReasonCode"];
}): boolean {
  if (args.queueKind !== "asset") {
    return false;
  }

  return args.reasonCode === "scheduled_match" || args.reasonCode === "manual_next";
}

export function resolvePoolAudioLane(args: {
  state: AppState;
  poolId?: string;
  queueKind: AppState["playout"]["queueItems"][number]["kind"];
  reasonCode: AppState["playout"]["selectionReasonCode"];
}): ResolvedAudioLane | null {
  if (!args.poolId || !shouldUsePoolAudioLane({ queueKind: args.queueKind, reasonCode: args.reasonCode })) {
    return null;
  }

  const pool = args.state.pools.find((entry) => entry.id === args.poolId) ?? null;
  if (!pool?.audioLaneAssetId) {
    return null;
  }

  const asset =
    args.state.assets.find((entry) => entry.id === pool.audioLaneAssetId && entry.status === "ready") ?? null;
  if (!asset) {
    return null;
  }

  return {
    asset,
    volumePercent: normalizeAudioLaneVolumePercent(pool.audioLaneVolumePercent ?? 100),
    poolId: pool.id,
    poolName: pool.name
  };
}
