"use client";

import { AdminPageHeader } from "@/components/admin-page-header";
import {
  getBroadcastLiveStatusLabel,
  getBroadcastLiveStatusTone,
  getBroadcastLiveUptimeLabel,
  getBroadcastLiveViewerCountLabel
} from "@/components/broadcast-live-status";
import { StatusChip, type StatusChipProps } from "@/components/ui/StatusChip";
import { useLiveSnapshot } from "@/components/use-live-snapshot";
import type { BroadcastSnapshot } from "@/lib/live-broadcast";

function getPlayoutStatusChip(playoutStatus: string): { label: string; status: StatusChipProps["status"] } {
  const normalized = playoutStatus.trim().toLowerCase();

  if (normalized === "running") {
    return { label: "Feed running", status: "ok" };
  }

  if (normalized === "idle" || normalized === "standby") {
    return { label: `Feed ${playoutStatus || "idle"}`, status: "offline" };
  }

  return { label: `Feed ${playoutStatus || "unknown"}`, status: "degraded" };
}

export function LiveWorkspaceHeader(props: { initialSnapshot: BroadcastSnapshot }) {
  const { snapshot, connected } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/broadcast/state",
    streamUrl: "/api/broadcast/stream"
  });
  const playoutChip = getPlayoutStatusChip(snapshot.playout.status);

  return (
    <AdminPageHeader
      compact
      description="Twitch channel state, viewer count, uptime, and playout health stay visible while you move between Live control, status, and moderation."
      eyebrow="Live"
      title="Keep channel and playout state visible across the whole Live workspace."
    >
      <div className="stats-row">
        <StatusChip
          label={getBroadcastLiveStatusLabel(snapshot.twitch)}
          status={getBroadcastLiveStatusTone(snapshot.twitch)}
        />
        <StatusChip label={playoutChip.label} status={playoutChip.status} />
      </div>
      <div className="status-rail">
        <div>
          <span className="label">Twitch uptime</span>
          <strong>{getBroadcastLiveUptimeLabel(snapshot.twitch)}</strong>
        </div>
        <div>
          <span className="label">Viewers</span>
          <strong>{getBroadcastLiveViewerCountLabel(snapshot.twitch)}</strong>
        </div>
        <div>
          <span className="label">Channel</span>
          <strong>{snapshot.twitch.broadcasterLogin || "Not connected"}</strong>
        </div>
        <div>
          <span className="label">Updates</span>
          <strong>{connected ? "Live" : "Polling"}</strong>
        </div>
      </div>
    </AdminPageHeader>
  );
}
