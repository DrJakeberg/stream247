import Link from "next/link";
import {
  describeScheduleBlockRun,
  formatScheduleDayHeading,
  formatScheduleHours,
  type MaterializedProgrammingBlock,
  type MaterializedProgrammingDay
} from "@stream247/core";
import type { AssetRecord } from "@/lib/server/state";
import { buildAssetDisplayTitle, isReplayTitlePrefix } from "@/lib/asset-metadata";
import { EmptyState } from "@/components/ui/EmptyState";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";

// The day lens lists every block with its edit form; the anchor scrolls to the one to edit (U6).
export function buildEditBlockHref(block: Pick<MaterializedProgrammingBlock, "blockId" | "dayOfWeek">): string {
  return `${buildWorkspaceHref("program", "schedule", { lens: "day", day: String(block.dayOfWeek) })}#schedule-block-${block.blockId}`;
}

export function buildAddBlockHref(dayOfWeek: number): string {
  return `${buildWorkspaceHref("program", "schedule", { lens: "day", day: String(dayOfWeek), add: "1" })}#add-schedule-block`;
}

export function ProgramWeekLens(props: { days: MaterializedProgrammingDay[]; assets: AssetRecord[] }) {
  const assetById = new Map(props.assets.map((asset) => [asset.id, asset]));

  return (
    <div className="stack-form">
      {/* One "Add block" for the week, not one per day: the page keeps its control budget, and the day
          lens it opens has the weekday picker (control-density.spec.ts). */}
      <div className="program-week-toolbar">
        <Link className="button secondary" href={buildAddBlockHref(props.days[0]?.dayOfWeek ?? 1)}>
          Add block
        </Link>
      </div>
      <div className="program-week-grid">
        {props.days.map((day) => (
          <section className="program-day-card" key={day.date}>
            <div className="stats-row">
              <div>
                <span className="label">{formatScheduleDayHeading(day.date)}</span>
                <strong>{day.blockCount > 0 ? `${day.blockCount} block${day.blockCount === 1 ? "" : "s"}` : "No programming"}</strong>
              </div>
              <span className="subtle">{formatScheduleHours(day.totalScheduledMinutes)} scheduled</span>
            </div>
            <div className="stack-form">
              {day.blocks.length > 0 ? (
                day.blocks.map((block) => {
                  const firstTitle = block.items[0] ? buildAssetDisplayTitle(assetById.get(block.items[0].assetId) ?? null, block.items[0].title) : "";
                  const details = [
                    block.title,
                    block.poolName,
                    block.durationLabel ?? formatScheduleHours(block.durationMinutes),
                    block.repeatLabel,
                    block.dated ? describeScheduleBlockRun(block).label : ""
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  // A block that has ended today keeps the same lines, so the card does not change shape as
                  // the day goes on; it has nothing ahead to open.
                  if (block.aired) {
                    return (
                      <div className="program-week-block schedule-block-ended" key={block.blockId}>
                        <div className="program-week-block-summary">
                          <div>
                            <span className="label">{block.timeLabel}</span>
                            <strong>Aired earlier today</strong>
                            <div className="subtle">{details}</div>
                            {block.repeatReason ? <div className="subtle">{block.repeatReason}</div> : null}
                          </div>
                          <span className={`programming-status-pill programming-status-${block.fillStatus}`}>{block.fillLabel}</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <details className="program-week-block" key={block.blockId}>
                      <summary className="program-week-block-summary">
                        <div>
                          <span className="label">{block.timeLabel}</span>
                          <strong>{firstTitle || "No playable video resolved"}</strong>
                          <div className="subtle">{details}</div>
                          {block.repeatReason ? <div className="subtle">{block.repeatReason}</div> : null}
                        </div>
                        <span className={`programming-status-pill programming-status-${block.fillStatus}`}>{block.fillLabel}</span>
                      </summary>
                      <div className="program-week-block-actions">
                        <Link className="button secondary" href={buildEditBlockHref(block)}>
                          Edit block
                        </Link>
                      </div>
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
                  description="Add a schedule block or ready assets to preview what this day plays."
                  title="No programming for this day"
                />
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
