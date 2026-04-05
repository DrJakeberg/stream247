"use client";

import { formatMinuteOfDay, type MaterializedProgrammingDay, type ScheduleBlock } from "@stream247/core";
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
  pools: Array<{
    id: string;
    name: string;
    insertAssetId: string;
    insertEveryItems: number;
    audioLaneAssetId: string;
    audioLaneVolumePercent: number;
  }>;
  assets: Array<{ id: string; title: string; status: string }>;
  showProfiles: ShowProfileRecord[];
  timeZone: string;
  materializedDays: MaterializedProgrammingDay[];
  liveQueueItems: Array<{ id: string; kind: string; title: string; subtitle: string }>;
};

export function ScheduleEditorWorkspace({
  blocks,
  conflicts,
  pools,
  assets,
  showProfiles,
  timeZone,
  materializedDays,
  liveQueueItems
}: Props) {
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
  const activeMaterializedDay = materializedDays.find((day) => day.dayOfWeek === activeDay) ?? null;
  const materializedByBlockId = new Map((activeMaterializedDay?.blocks || []).map((block) => [block.blockId, block]));
  const dayUnderfilled = activeMaterializedDay?.underfilledCount ?? 0;
  const dayOverflow = activeMaterializedDay?.overflowCount ?? 0;
  const dayEmpty = activeMaterializedDay?.emptyCount ?? 0;

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

      <div className="programming-workspace-grid">
        <div className="programming-workspace-card">
          <span className="label">Day fill</span>
          <strong>
            {activeMaterializedDay?.blockCount
              ? `${activeMaterializedDay.blockCount} materialized block${activeMaterializedDay.blockCount === 1 ? "" : "s"}`
              : "No materialized blocks"}
          </strong>
          <div className="programming-day-flags">
            {dayUnderfilled ? <span className="programming-status-pill programming-status-underfilled">{dayUnderfilled} repeat risk</span> : null}
            {dayOverflow ? <span className="programming-status-pill programming-status-overflow">{dayOverflow} overflow</span> : null}
            {dayEmpty ? <span className="programming-status-pill programming-status-empty">{dayEmpty} empty</span> : null}
            {!dayUnderfilled && !dayOverflow && !dayEmpty && (activeMaterializedDay?.blockCount ?? 0) > 0 ? (
              <span className="programming-status-pill programming-status-balanced">Balanced</span>
            ) : null}
          </div>
          <div className="subtle">
            {activeMaterializedDay
              ? `${activeMaterializedDay.totalScheduledMinutes}m scheduled · ${activeMaterializedDay.totalProjectedMinutes}m projected`
              : "No schedule blocks are materialized for this weekday yet."}
          </div>
        </div>
        <div className="programming-workspace-card">
          <span className="label">Live queue context</span>
          <strong>{liveQueueItems.length > 0 ? "Current runtime queue" : "No live queue published"}</strong>
          <div className="subtle">
            {liveQueueItems.length > 0
              ? liveQueueItems
                  .slice(0, 4)
                  .map((item) => `${item.kind.toUpperCase()} · ${item.title}`)
                  .join(" · ")
              : "Use this next to the day fill preview to compare planned blocks with real on-air state."}
          </div>
        </div>
      </div>

      <ScheduleTimeline
        activeDay={activeDay}
        blocks={filteredBlocks}
        conflicts={conflicts}
        materializedBlocks={Object.fromEntries(materializedByBlockId)}
        onActiveDayChange={setActiveDay}
        showProfiles={showProfiles}
        timeZone={timeZone}
      />

      <div className="list">
        {visibleBlocks.map((block) => {
          const show = showProfiles.find((entry) => entry.id === block.showId);
          const pool = pools.find((entry) => entry.id === block.poolId);
          const materialized = materializedByBlockId.get(block.id);

          return (
            <div className="item" key={block.id}>
              <div className="stats-row">
                <strong>{block.title}</strong>
                {materialized ? (
                  <span className={`programming-status-pill programming-status-${materialized.fillStatus}`}>{materialized.fillLabel}</span>
                ) : null}
                <span className="subtle">{materialized?.repeatLabel || "Single day"}</span>
              </div>
              <div className="subtle">
                {dayLabels[block.dayOfWeek]} · {formatMinuteOfDay(block.startMinuteOfDay)} · {block.durationMinutes} minutes · {pool?.name || block.sourceName}
              </div>
              <div className="subtle">
                {block.categoryName}
                {show ? ` · Show: ${show.name}` : ""}
                {conflictSet.has(block.id) ? " · Conflict detected" : ""}
                {pool?.insertAssetId && pool.insertEveryItems > 0 ? ` · Insert every ${pool.insertEveryItems}` : ""}
                {pool?.audioLaneAssetId ? ` · Audio lane ${pool.audioLaneVolumePercent}%` : ""}
                {block.cuepointOffsetsSeconds?.length ? ` · ${block.cuepointOffsetsSeconds.length} cuepoint${block.cuepointOffsetsSeconds.length === 1 ? "" : "s"}` : ""}
              </div>
              {materialized ? (
                <>
                  <div className="subtle">
                    Unique fill {materialized.uniqueMinutes}m · Projected {materialized.projectedMinutes}m
                    {materialized.insertCount > 0 ? ` · ${materialized.insertCount} insert${materialized.insertCount === 1 ? "" : "s"}` : ""}
                    {materialized.cuepointCount > 0 ? ` · ${materialized.cuepointCount} cuepoint-triggered` : ""}
                  </div>
                  {materialized.queuePreview.length > 0 ? (
                    <div className="subtle">Queue preview: {materialized.queuePreview.join(" · ")}</div>
                  ) : null}
                  {materialized.notes.map((note) => (
                    <div className="subtle" key={note}>
                      {note}
                    </div>
                  ))}
                </>
              ) : null}
              <div style={{ marginTop: 12 }}>
                <ScheduleBlockForm assets={assets} block={block} pools={pools} shows={showProfiles} />
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
