"use client";

import { formatMinuteOfDay, type ScheduleBlock } from "@stream247/core";
import { useState } from "react";
import { ScheduleBlockDeleteForm } from "@/components/schedule-block-delete-form";
import { ScheduleBlockDuplicateForm } from "@/components/schedule-block-duplicate-form";
import { ScheduleBlockForm } from "@/components/schedule-block-form";
import { ScheduleTimeline } from "@/components/schedule-timeline";
import type { ShowProfileRecord } from "@/lib/server/state";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  blocks: ScheduleBlock[];
  conflicts: string[];
  pools: Array<{ id: string; name: string }>;
  showProfiles: ShowProfileRecord[];
  timeZone: string;
};

export function ScheduleEditorWorkspace({ blocks, conflicts, pools, showProfiles, timeZone }: Props) {
  const [activeDay, setActiveDay] = useState<number>(1);
  const [query, setQuery] = useState("");
  const [poolId, setPoolId] = useState("");
  const [showId, setShowId] = useState("");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const conflictSet = new Set(conflicts);
  const normalizedQuery = query.trim().toLowerCase();

  const filteredBlocks = blocks.filter((block) => {
    if (poolId && block.poolId !== poolId) {
      return false;
    }

    if (showId && block.showId !== showId) {
      return false;
    }

    if (conflictsOnly && !conflictSet.has(block.id)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const show = showProfiles.find((entry) => entry.id === block.showId);
    const haystack = [block.title, block.categoryName, block.sourceName, show?.name || ""].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const visibleBlocks = filteredBlocks
    .filter((block) => block.dayOfWeek === activeDay)
    .slice()
    .sort((left, right) => left.startMinuteOfDay - right.startMinuteOfDay);

  return (
    <div className="stack-form">
      <p className="subtle">
        Search and filter the week before editing. This makes it much easier to manage recurring shows, pool rotations,
        and conflict cleanup without scrolling through the full schedule every time.
      </p>
      <div className="form-grid">
        <label>
          <span className="label">Search</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, category, source, or show"
            value={query}
          />
        </label>
        <label>
          <span className="label">Pool</span>
          <select onChange={(event) => setPoolId(event.target.value)} value={poolId}>
            <option value="">All pools</option>
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Show profile</span>
          <select onChange={(event) => setShowId(event.target.value)} value={showId}>
            <option value="">All shows</option>
            {showProfiles.map((show) => (
              <option key={show.id} value={show.id}>
                {show.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="toggle-row" style={{ flexWrap: "wrap", gap: 8 }}>
        <label className={`chip-toggle${conflictsOnly ? " chip-toggle-active" : ""}`}>
          <input checked={conflictsOnly} onChange={(event) => setConflictsOnly(event.target.checked)} type="checkbox" />
          <span>Conflicts only</span>
        </label>
        <button
          className="button secondary"
          onClick={() => {
            setQuery("");
            setPoolId("");
            setShowId("");
            setConflictsOnly(false);
          }}
          type="button"
        >
          Clear filters
        </button>
        <span className="subtle">
          Showing {visibleBlocks.length} blocks on {dayLabels[activeDay]} · {filteredBlocks.length} matching blocks across the week
        </span>
      </div>

      <ScheduleTimeline
        activeDay={activeDay}
        blocks={filteredBlocks}
        conflicts={conflicts}
        onActiveDayChange={setActiveDay}
        showProfiles={showProfiles}
        timeZone={timeZone}
      />

      <div className="list">
        {visibleBlocks.map((block) => {
          const show = showProfiles.find((entry) => entry.id === block.showId);
          const pool = pools.find((entry) => entry.id === block.poolId);

          return (
            <div className="item" key={block.id}>
              <strong>{block.title}</strong>
              <div className="subtle">
                {dayLabels[block.dayOfWeek]} · {formatMinuteOfDay(block.startMinuteOfDay)} · {block.durationMinutes} minutes ·{" "}
                {pool?.name || block.sourceName}
              </div>
              <div className="subtle">
                {block.categoryName}
                {show ? ` · Show: ${show.name}` : ""}
                {conflictSet.has(block.id) ? " · Conflict detected" : ""}
              </div>
              <div style={{ marginTop: 12 }}>
                <ScheduleBlockForm block={block} pools={pools} shows={showProfiles} />
              </div>
              <div style={{ marginTop: 8 }}>
                <ScheduleBlockDuplicateForm block={block} />
              </div>
              <div style={{ marginTop: 8 }}>
                <ScheduleBlockDeleteForm id={block.id} />
              </div>
            </div>
          );
        })}
        {visibleBlocks.length === 0 ? (
          <div className="item">
            <strong>No blocks match this view</strong>
            <div className="subtle">Adjust the day or filters to bring matching programming blocks back into view.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
