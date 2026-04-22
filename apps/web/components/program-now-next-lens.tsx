import Link from "next/link";
import type { AssetRecord } from "@/lib/server/state";
import type { BroadcastSnapshot } from "@/lib/live-broadcast";
import { buildAssetDisplayTitle, isReplayTitlePrefix } from "@/lib/asset-metadata";
import { EmptyState } from "@/components/ui/EmptyState";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";

function buildQueueHref(assetId: string) {
  return buildWorkspaceHref("program", "schedule", { lens: "now-next", assetId });
}

export function ProgramNowNextLens(props: {
  snapshot: BroadcastSnapshot;
  fallbackAssets: AssetRecord[];
}) {
  const currentAsset = props.snapshot.currentAsset;
  const queue = props.snapshot.queueItems.filter((item) => item.position > 0).slice(0, 2);
  const nextTitle = props.snapshot.playout.nextTitle || props.snapshot.nextAsset?.title || "";

  return (
    <div className="program-now-next-grid">
      <section className="program-focus-card">
        <span className="label">Current</span>
        <strong>{buildAssetDisplayTitle(currentAsset, props.snapshot.playout.currentTitle || "Standby") || "Standby"}</strong>
        <div className="subtle">
          {props.snapshot.currentScheduleItem
            ? `${props.snapshot.currentScheduleItem.startTime} to ${props.snapshot.currentScheduleItem.endTime} · ${props.snapshot.currentScheduleItem.title}`
            : props.snapshot.playout.selectionReasonCode || "No active schedule window"}
        </div>
        {currentAsset ? (
          <div className="program-item-flags">
            {currentAsset.categoryName ? (
              <span className="programming-status-pill programming-status-balanced">{currentAsset.categoryName}</span>
            ) : null}
            <Link className="button button-ghost" href={buildQueueHref(currentAsset.id)}>
              Edit metadata
            </Link>
          </div>
        ) : null}
      </section>

      <section className="program-focus-card">
        <span className="label">Next two</span>
        {nextTitle ? <strong>{nextTitle}</strong> : <strong>No next video resolved</strong>}
        <div className="subtle">
          {props.snapshot.nextScheduleItem
            ? `${props.snapshot.nextScheduleItem.startTime} to ${props.snapshot.nextScheduleItem.endTime} · ${props.snapshot.nextScheduleItem.title}`
            : "Queue resolution will happen on the next worker cycle."}
        </div>
        {queue.length > 0 ? (
          <div className="program-sequence-list">
            {queue.map((item) => (
              <Link
                className="program-sequence-item"
                href={item.asset?.id ? buildQueueHref(item.asset.id) : buildWorkspaceHref("program", "pools")}
                key={item.id}
              >
                <div>
                  <strong>{item.title}</strong>
                  <div className="subtle">{item.subtitle || item.kind}</div>
                </div>
                {item.asset?.categoryName ? (
                  <span className="programming-status-pill programming-status-balanced">{item.asset.categoryName}</span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            action={
              <Link className="button secondary" href={buildWorkspaceHref("program", "pools")}>
                Open pools
              </Link>
            }
            description="The next title did not resolve to a playable queue item. Check the linked pools or ready library assets."
            title="No playable next item"
          />
        )}
      </section>

      <section className="program-focus-card">
        <span className="label">Fallback chain</span>
        <strong>{props.fallbackAssets.length > 0 ? "Global fallback order" : "No fallback assets configured"}</strong>
        {props.fallbackAssets.length > 0 ? (
          <div className="program-sequence-list">
            {props.fallbackAssets.map((asset) => (
              <Link className="program-sequence-item" href={buildQueueHref(asset.id)} key={asset.id}>
                <div>
                  <strong>{buildAssetDisplayTitle(asset, asset.title)}</strong>
                  <div className="subtle">
                    Priority {asset.fallbackPriority}
                    {asset.categoryName ? ` · ${asset.categoryName}` : ""}
                  </div>
                </div>
                {isReplayTitlePrefix(asset.titlePrefix) ? (
                  <span className="programming-status-pill programming-status-overflow">Replay</span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            action={
              <Link className="button secondary" href={buildWorkspaceHref("program", "library")}>
                Open library
              </Link>
            }
            description="Mark one or more ready assets as global fallback so the live pipeline has a clean recovery ladder."
            title="No fallback chain configured"
          />
        )}
      </section>
    </div>
  );
}
