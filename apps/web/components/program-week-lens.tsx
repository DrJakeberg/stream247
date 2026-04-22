import Link from "next/link";
import { lookaheadVideoTitleFromPool, type MaterializedProgrammingDay } from "@stream247/core";
import type { AssetRecord, PoolRecord } from "@/lib/server/state";
import { buildAssetDisplayTitle, isReplayTitlePrefix } from "@/lib/asset-metadata";
import { EmptyState } from "@/components/ui/EmptyState";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ProgramWeekLens(props: {
  days: MaterializedProgrammingDay[];
  pools: PoolRecord[];
  assets: AssetRecord[];
}) {
  const poolById = new Map(props.pools.map((pool) => [pool.id, pool]));
  const assetById = new Map(props.assets.map((asset) => [asset.id, asset]));

  return (
    <div className="program-week-grid">
      {props.days.map((day) => (
        <section className="program-day-card" key={day.date}>
          <div className="stats-row">
            <div>
              <span className="label">{dayLabels[day.dayOfWeek]}</span>
              <strong>{day.blockCount > 0 ? `${day.blockCount} block${day.blockCount === 1 ? "" : "s"}` : "No programming"}</strong>
            </div>
            <span className="subtle">{day.totalScheduledMinutes}m scheduled</span>
          </div>
          <div className="stack-form">
            {day.blocks.length > 0 ? (
              day.blocks.map((block) => {
                const pool = block.poolId ? poolById.get(block.poolId) ?? null : null;
                const nextTitle =
                  lookaheadVideoTitleFromPool({
                    pool,
                    assets: props.assets
                  }) ||
                  block.items[0]?.title ||
                  "";

                return (
                  <details className="program-week-block" key={block.blockId}>
                    <summary className="program-week-block-summary">
                      <div>
                        <span className="label">
                          {block.startTime} to {block.endTime}
                        </span>
                        <strong>{nextTitle || "No playable video resolved"}</strong>
                        <div className="subtle">
                          {block.title} · {block.poolName} · {block.repeatLabel}
                        </div>
                      </div>
                      <span className={`programming-status-pill programming-status-${block.fillStatus}`}>{block.fillLabel}</span>
                    </summary>
                    {block.items.length > 0 ? (
                      <div className="program-sequence-list">
                        {block.items.map((item) => {
                          const asset = assetById.get(item.assetId) ?? null;
                          const replayEnabled = isReplayTitlePrefix(asset?.titlePrefix);

                          return (
                            <Link
                              className="program-sequence-item"
                              href={buildWorkspaceHref("program", "schedule", {
                                lens: "week",
                                day: String(day.dayOfWeek),
                                assetId: item.assetId
                              })}
                              key={`${block.blockId}-${item.assetId}-${item.startTime}`}
                            >
                              <div>
                                <strong>{buildAssetDisplayTitle(asset, item.title)}</strong>
                                <div className="subtle">
                                  {item.startTime} to {item.endTime} · {item.durationMinutes}m
                                  {asset?.categoryName ? ` · ${asset.categoryName}` : ""}
                                </div>
                              </div>
                              <div className="program-item-flags">
                                {replayEnabled ? (
                                  <span className="programming-status-pill programming-status-overflow">Replay</span>
                                ) : null}
                                {item.kind === "insert" ? (
                                  <span className="programming-status-pill programming-status-underfilled">Insert</span>
                                ) : null}
                                {item.repeated ? (
                                  <span className="programming-status-pill programming-status-balanced">Repeated</span>
                                ) : null}
                                {item.overflow ? (
                                  <span className="programming-status-pill programming-status-empty">Overflow</span>
                                ) : null}
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    ) : (
                      <EmptyState
                        action={
                          <Link className="button secondary" href={buildWorkspaceHref("program", block.poolId ? "pools" : "library")}>
                            {block.poolId ? "Open pools" : "Open library"}
                          </Link>
                        }
                        description={
                          block.poolId
                            ? "This block's pool has no ready assets yet, so nothing can resolve on air."
                            : "This block has no linked pool, so there is no playable video sequence to preview."
                        }
                        title="No playable video resolved"
                      />
                    )}
                  </details>
                );
              })
            ) : (
              <EmptyState
                action={
                  <Link className="button secondary" href={buildWorkspaceHref("program", "schedule", { lens: "day", day: String(day.dayOfWeek) })}>
                    Open day lens
                  </Link>
                }
                description="Add schedule blocks or ready assets to preview the week's resolved video sequence."
                title="No programming for this day"
              />
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
