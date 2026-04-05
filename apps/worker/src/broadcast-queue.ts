import type { AssetRecord, BroadcastQueueItemRecord } from "@stream247/db";

export function prioritizeManualNextAsset(queue: AssetRecord[], manualNextAsset: AssetRecord | null): AssetRecord[] {
  if (!manualNextAsset) {
    return queue;
  }

  return [manualNextAsset, ...queue.filter((asset) => asset.id !== manualNextAsset.id)];
}

export function incrementQueueVersion(previousVersion: number, previousItems: BroadcastQueueItemRecord[], nextItems: BroadcastQueueItemRecord[]): number {
  const previousSignature = JSON.stringify(previousItems ?? []);
  const nextSignature = JSON.stringify(nextItems ?? []);
  return previousSignature === nextSignature ? previousVersion : previousVersion + 1;
}
