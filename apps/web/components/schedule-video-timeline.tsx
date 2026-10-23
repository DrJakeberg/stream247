"use client";

import { Fragment, useState } from "react";
import type { MaterializedProgrammingBlock } from "@stream247/core";
import { buildScheduleVideoTimelineSegments, describeMaterializedBlockFill } from "@/lib/schedule-video-timeline";

export function ScheduleVideoTimeline({
  blocks,
  dayLabels
}: {
  blocks: MaterializedProgrammingBlock[];
  dayLabels: string[];
}) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  function toggle(key: string) {
    setExpandedKeys((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  }

  return (
    <div className="list">
      {blocks.map((block) => {
        const key = `${block.dayOfWeek}:${block.blockId}:${block.startTime}`;
        const expanded = expandedKeys.includes(key);
        const segments = buildScheduleVideoTimelineSegments(block);

        return (
          <div className="item" key={key}>
            <div className="stats-row">
              <strong>{block.title}</strong>
              <span className={`programming-status-pill programming-status-${block.fillStatus}`}>{block.fillLabel}</span>
              <span className="subtle">
                {dayLabels[block.dayOfWeek]} · {block.timeLabel || `${block.startTime} → ${block.endTime}`} · {block.poolName}
              </span>
              {block.aired ? null : (
                <button className="button secondary" onClick={() => toggle(key)} type="button">
                  {expanded ? "Hide videos" : "Show videos"}
                </button>
              )}
            </div>
            <div className="subtle">{block.aired ? "Aired earlier today" : describeMaterializedBlockFill(block)}</div>
            {block.repeatReason ? <div className="subtle">{block.repeatReason}</div> : null}
            {block.notes.map((note) => (
              <div className="subtle" key={note}>
                {note}
              </div>
            ))}
            {expanded ? (
              <div className="schedule-video-timeline-panel">
                {segments.length > 0 ? (
                  <div className="schedule-video-timeline" role="list">
                    {segments.map((segment, index) => (
                      <Fragment key={`${segment.assetId}-${segment.startOffsetSeconds}-${index}`}>
                        {/* Time the block is not on air (a dated block's cut), so later videos sit at their real time. */}
                        {segment.gapBeforePercent > 0 ? (
                          <div aria-hidden="true" style={{ flexBasis: `${segment.gapBeforePercent}%`, flexShrink: 0 }} />
                        ) : null}
                        <div
                          className="schedule-video-slot"
                          role="listitem"
                          style={{ flexBasis: `${segment.widthPercent}%` }}
                          title={segment.title}
                        >
                          <span>{segment.title}</span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                ) : (
                  <div className="subtle">
                    {block.fillLabel === "Covered by the item before"
                      ? "The item before runs past this block, so none of its videos air."
                      : block.poolId
                        ? "Nothing in this pool can play yet"
                        : "No pool linked to this block"}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {blocks.length === 0 ? (
        <div className="item">
          <strong>No blocks on this day</strong>
          <div className="subtle">Add a block to see which videos it will play.</div>
        </div>
      ) : null}
    </div>
  );
}
