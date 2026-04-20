"use client";

import { useState } from "react";
import type { SchedulePreview } from "@stream247/core";
import { buildScheduleVideoTimelineSegments } from "@/lib/schedule-video-timeline";

type SchedulePreviewItem = SchedulePreview["items"][number];

function itemKey(item: SchedulePreviewItem): string {
  return `${item.dayOfWeek}:${item.id}:${item.startTime}:${item.endTime}`;
}

export function ScheduleVideoTimeline({
  items,
  dayLabels
}: {
  items: SchedulePreviewItem[];
  dayLabels: string[];
}) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  function toggle(item: SchedulePreviewItem) {
    const key = itemKey(item);
    setExpandedKeys((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  }

  return (
    <div className="list">
      {items.map((item) => {
        const key = itemKey(item);
        const expanded = expandedKeys.includes(key);
        const segments = buildScheduleVideoTimelineSegments(item);

        return (
          <div className="item" key={key}>
            <div className="stats-row">
              <strong>{item.title}</strong>
              <span className="subtle">
                {dayLabels[item.dayOfWeek]} · {item.startTime} to {item.endTime} · {item.sourceName}
              </span>
              <button className="button secondary" onClick={() => toggle(item)} type="button">
                {expanded ? "Hide videos" : "Show videos"}
              </button>
            </div>
            <div className="subtle">{item.reason}</div>
            {expanded ? (
              <div className="schedule-video-timeline-panel">
                {segments.length > 0 ? (
                  <div className="schedule-video-timeline" role="list">
                    {segments.map((segment, index) => (
                      <div
                        className="schedule-video-slot"
                        key={`${segment.assetId}-${segment.startOffsetSeconds}-${index}`}
                        role="listitem"
                        style={{ flexBasis: `${segment.widthPercent}%` }}
                        title={segment.title}
                      >
                        <span>{segment.title}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="subtle">{item.poolId ? "No videos in pool" : "No pool linked to block"}</div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {items.length === 0 ? (
        <div className="item">
          <strong>No schedule blocks</strong>
          <div className="subtle">Add schedule blocks to see video-level timeline predictions.</div>
        </div>
      ) : null}
    </div>
  );
}
