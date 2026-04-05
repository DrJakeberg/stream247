import { appendAuditEvent, readAppState, updatePlayoutRuntime } from "@/lib/server/state";

type BroadcastAction =
  | { type: "restart" | "hard_reload" }
  | { type: "refresh" | "rebuild_queue" }
  | { type: "force_reconnect" }
  | { type: "fallback" }
  | { type: "resume" }
  | { type: "trigger_insert"; assetId: string }
  | { type: "play_now"; assetId: string }
  | { type: "move_next"; assetId: string }
  | { type: "remove_next" }
  | { type: "replay_previous" }
  | { type: "skip"; minutes?: number }
  | { type: "override"; assetId: string; minutes?: number };

function addMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function runBroadcastAction(action: BroadcastAction): Promise<{ ok: true; message: string }> {
  const state = await readAppState();
  const now = new Date().toISOString();

  if (action.type === "refresh" || action.type === "rebuild_queue") {
    const message =
      action.type === "refresh"
        ? "Broadcast refresh requested. Overlay and slate payloads will be rebuilt on the next playout cycle."
        : "Broadcast queue rebuild requested. The next playout cycle will recalculate the visible queue.";
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      pendingAction: action.type,
      pendingActionRequestedAt: now,
      heartbeatAt: now,
      message
    }));
    await appendAuditEvent(
      `broadcast.${action.type}.requested`,
      action.type === "refresh" ? "Broadcast refresh requested." : "Broadcast queue rebuild requested."
    );
    return { ok: true, message };
  }

  if (action.type === "restart" || action.type === "hard_reload") {
    const message =
      action.type === "restart"
        ? "Manual playout restart requested from the admin API."
        : "Hard reload requested. The encoder will restart from scratch on the next playout cycle.";
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      restartRequestedAt: now,
      heartbeatAt: now,
      pendingAction: "",
      pendingActionRequestedAt: "",
      message
    }));
    await appendAuditEvent(
      action.type === "restart" ? "playout.restart.requested" : "broadcast.hard-reload.requested",
      action.type === "restart" ? "Manual playout restart was requested." : "Broadcast hard reload was requested."
    );
    return { ok: true, message };
  }

  if (action.type === "force_reconnect") {
    const message = "Manual reconnect requested. The encoder will enter the reconnect window on the next playout cycle.";
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "reconnecting",
      restartRequestedAt: now,
      heartbeatAt: now,
      pendingAction: "",
      pendingActionRequestedAt: "",
      message
    }));
    await appendAuditEvent("broadcast.reconnect.requested", "Manual reconnect was requested.");
    return { ok: true, message };
  }

  if (action.type === "fallback") {
    const fallback = [...state.assets]
      .filter((asset) => asset.status === "ready" && asset.isGlobalFallback && asset.includeInProgramming !== false)
      .sort((left, right) => left.fallbackPriority - right.fallbackPriority)[0];

    if (!fallback) {
      throw new Error("No global fallback asset is configured.");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      desiredAssetId: fallback.id,
      restartRequestedAt: now,
      heartbeatAt: now,
      overrideMode: "fallback",
      overrideAssetId: fallback.id,
      overrideUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      message: `Manual fallback requested for asset ${fallback.title}.`
    }));
    await appendAuditEvent("playout.fallback.requested", `Manual fallback requested for ${fallback.title}.`);
    return { ok: true, message: `Manual fallback requested for ${fallback.title}.` };
  }

  if (action.type === "resume") {
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      desiredAssetId: "",
      restartRequestedAt: now,
      heartbeatAt: now,
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      skipAssetId: "",
      skipUntil: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      message: "Operator override cleared. Schedule control resumed."
    }));
    await appendAuditEvent("playout.resume.schedule", "Operator override cleared and schedule control resumed.");
    return { ok: true, message: "Schedule control resumed." };
  }

  if (action.type === "trigger_insert" || action.type === "play_now") {
    const asset = state.assets.find((entry) => entry.id === action.assetId && entry.status === "ready");
    if (!asset) {
      throw new Error("The requested insert asset is not available.");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      restartRequestedAt: now,
      heartbeatAt: now,
      insertAssetId: asset.id,
      insertRequestedAt: now,
      insertStatus: "pending",
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      message: `${action.type === "play_now" ? "Play now" : "Insert"} requested for ${asset.title}.`
    }));
    await appendAuditEvent(
      action.type === "play_now" ? "playout.play-now.requested" : "playout.insert.requested",
      `${action.type === "play_now" ? "Operator requested play now" : "Operator requested insert"} ${asset.title}.`
    );
    return { ok: true, message: `${action.type === "play_now" ? "Play now" : "Insert"} requested for ${asset.title}.` };
  }

  if (action.type === "move_next") {
    const asset = state.assets.find((entry) => entry.id === action.assetId && entry.status === "ready");
    if (!asset) {
      throw new Error("The requested asset is not available to move next.");
    }
    if (asset.id === state.playout.currentAssetId) {
      throw new Error("The selected asset is already on air.");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      manualNextAssetId: asset.id,
      manualNextRequestedAt: now,
      pendingAction: "rebuild_queue",
      pendingActionRequestedAt: now,
      heartbeatAt: now,
      message: `${asset.title} has been pinned as the next queue item.`
    }));
    await appendAuditEvent("playout.move-next.requested", `Operator moved ${asset.title} to the next queue slot.`);
    return { ok: true, message: `${asset.title} will play next.` };
  }

  if (action.type === "remove_next") {
    const nextQueueItem = state.playout.queueItems[1] ?? null;
    if (!nextQueueItem?.assetId) {
      throw new Error("There is no removable next queue asset.");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      skipAssetId: nextQueueItem.assetId,
      skipUntil: addMinutes(60),
      manualNextAssetId: playout.manualNextAssetId === nextQueueItem.assetId ? "" : playout.manualNextAssetId,
      manualNextRequestedAt: playout.manualNextAssetId === nextQueueItem.assetId ? "" : playout.manualNextRequestedAt,
      pendingAction: "rebuild_queue",
      pendingActionRequestedAt: now,
      heartbeatAt: now,
      message: `${nextQueueItem.title} was removed from the immediate next slot.`
    }));
    await appendAuditEvent("playout.remove-next.requested", `Operator removed ${nextQueueItem.title} from the next queue slot.`);
    return { ok: true, message: `${nextQueueItem.title} was removed from next.` };
  }

  if (action.type === "replay_previous") {
    const previousAsset = state.assets.find(
      (entry) => entry.id === state.playout.previousAssetId && entry.status === "ready" && entry.includeInProgramming !== false
    );
    if (!previousAsset) {
      throw new Error("There is no ready previous asset to replay next.");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      manualNextAssetId: previousAsset.id,
      manualNextRequestedAt: now,
      pendingAction: "rebuild_queue",
      pendingActionRequestedAt: now,
      heartbeatAt: now,
      message: `${previousAsset.title} will replay as the next item.`
    }));
    await appendAuditEvent("playout.replay-previous.requested", `Operator queued ${previousAsset.title} as the next replay item.`);
    return { ok: true, message: `${previousAsset.title} will replay next.` };
  }

  if (action.type === "skip") {
    const minutes = Math.max(5, Math.min(240, Number(action.minutes ?? 60) || 60));
    const currentAsset = state.assets.find((entry) => entry.id === state.playout.currentAssetId);
    if (!currentAsset) {
      throw new Error("No current asset is running, so there is nothing to skip.");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      restartRequestedAt: now,
      heartbeatAt: now,
      skipAssetId: currentAsset.id,
      skipUntil: addMinutes(minutes),
      pendingAction: "",
      pendingActionRequestedAt: "",
      message: `Skipped ${currentAsset.title} for ${minutes} minutes.`
    }));
    await appendAuditEvent("playout.skip.current", `Skipped ${currentAsset.title} for ${minutes} minutes.`);
    return { ok: true, message: "Current asset skipped." };
  }

  const assetId = String(action.type === "override" ? action.assetId : "");
  const minutes = Math.max(5, Math.min(240, Number(action.type === "override" ? action.minutes ?? 60 : 60) || 60));
  const asset = state.assets.find((entry) => entry.id === assetId && entry.status === "ready");
  if (!asset) {
    throw new Error("The requested asset is not available for override.");
  }

  await updatePlayoutRuntime((playout) => ({
    ...playout,
    status: "recovering",
    desiredAssetId: asset.id,
    restartRequestedAt: now,
    heartbeatAt: now,
    overrideMode: "asset",
    overrideAssetId: asset.id,
    overrideUntil: addMinutes(minutes),
    manualNextAssetId: "",
    manualNextRequestedAt: "",
    pendingAction: "",
    pendingActionRequestedAt: "",
    message: `Operator override selected ${asset.title} for ${minutes} minutes.`
  }));
  await appendAuditEvent("playout.override.asset", `Operator pinned ${asset.title} for ${minutes} minutes.`);
  return { ok: true, message: "Operator override applied." };
}
