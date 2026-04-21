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
