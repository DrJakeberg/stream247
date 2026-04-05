"use client";

import type { BroadcastSnapshot } from "@/lib/live-broadcast";
import { useLiveSnapshot } from "@/components/use-live-snapshot";

export function AdminStatusRail(props: { initialSnapshot: BroadcastSnapshot }) {
  const { snapshot, connected } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/broadcast/state",
    streamUrl: "/api/broadcast/stream"
  });
  const currentQueueItem = snapshot.queueItems[0] ?? null;
  const nextQueueItem = snapshot.queueItems[1] ?? null;

  return (
    <section className="admin-status-rail">
      <div className="admin-status-chip">
        <span className="label">Feed</span>
        <strong>{snapshot.playout.status}</strong>
        <span className="subtle">{snapshot.playout.transitionState || "idle"}</span>
      </div>
      <div className="admin-status-chip">
        <span className="label">Current</span>
        <strong>{currentQueueItem?.title || snapshot.currentAsset?.title || snapshot.playout.currentTitle || "Standby"}</strong>
        <span className="subtle">{snapshot.currentScheduleItem?.title || snapshot.playout.selectionReasonCode || "No active schedule window"}</span>
      </div>
      <div className="admin-status-chip">
        <span className="label">Next</span>
        <strong>{nextQueueItem?.title || snapshot.nextAsset?.title || snapshot.nextScheduleItem?.title || "Pending"}</strong>
        <span className="subtle">
          {snapshot.playout.prefetchStatus ? `Prefetch ${snapshot.playout.prefetchStatus}` : "Queue will resolve on next cycle"}
        </span>
      </div>
      <div className="admin-status-chip">
        <span className="label">Destination</span>
        <strong>{snapshot.destination?.name || "Missing"}</strong>
        <span className="subtle">{snapshot.destination?.status || "not configured"}</span>
      </div>
      <div className="admin-status-chip">
        <span className="label">Incidents</span>
        <strong>{snapshot.openIncidents.length}</strong>
        <span className="subtle">
          {snapshot.openIncidents[0]
            ? `${snapshot.openIncidents[0].severity} · ${snapshot.openIncidents[0].title}`
            : "No unresolved incidents"}
        </span>
      </div>
      <div className="admin-status-chip">
        <span className="label">Updates</span>
        <strong>{connected ? "Live" : "Polling"}</strong>
        <span className="subtle">{snapshot.workerHealth.lastRunAt || "No worker heartbeat yet"}</span>
      </div>
    </section>
  );
}
