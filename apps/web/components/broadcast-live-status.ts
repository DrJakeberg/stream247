import type { BroadcastSnapshot } from "@/lib/live-broadcast";
import type { StatusChipProps } from "@/components/ui/StatusChip";

export function getBroadcastLiveStatusLabel(twitch: BroadcastSnapshot["twitch"]): string {
  if (twitch.status === "live") {
    return twitch.viewerCount > 0 ? `LIVE ${twitch.viewerCount}` : "LIVE";
  }

  if (twitch.status === "offline") {
    return "OFFLINE";
  }

  return "UNKNOWN";
}

export function getBroadcastLiveStatusTone(twitch: BroadcastSnapshot["twitch"]): StatusChipProps["status"] {
  if (twitch.status === "live") {
    return "live";
  }

  if (twitch.status === "offline") {
    return "offline";
  }

  return "unknown";
}

export function getBroadcastLiveViewerCountLabel(twitch: BroadcastSnapshot["twitch"]): string {
  if (twitch.status !== "live") {
    return "0";
  }

  return String(Math.max(0, twitch.viewerCount || 0));
}

export function getBroadcastLiveUptimeLabel(
  twitch: BroadcastSnapshot["twitch"],
  now = Date.now()
): string {
  if (twitch.status !== "live" || !twitch.startedAt) {
    return "Not live";
  }

  const startedAtMs = new Date(twitch.startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return "Live";
  }

  const elapsedMinutes = Math.max(0, Math.floor((now - startedAtMs) / 60_000));
  const days = Math.floor(elapsedMinutes / (60 * 24));
  const hours = Math.floor((elapsedMinutes % (60 * 24)) / 60);
  const minutes = elapsedMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return "<1m";
}
