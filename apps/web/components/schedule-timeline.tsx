"use client";

import { formatMinuteOfDay, type ScheduleBlock } from "@stream247/core";
import { useRef, useState, useTransition } from "react";
import type { ShowProfileRecord } from "@/lib/server/state";

const minutesPerSlot = 15;
const slotHeight = 28;
const totalSlots = (24 * 60) / minutesPerSlot;
const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Props = {
  blocks: ScheduleBlock[];
  conflicts: string[];
  showProfiles: ShowProfileRecord[];
  timeZone: string;
};

export function ScheduleTimeline({ blocks, conflicts, showProfiles, timeZone }: Props) {
  const [draggedId, setDraggedId] = useState("");
  const [activeDay, setActiveDay] = useState(1);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const resizingRef = useRef<{ block: ScheduleBlock; startY: number; startDuration: number } | null>(null);
  const conflictSet = new Set(conflicts);

  async function saveBlock(block: ScheduleBlock, updates: Partial<ScheduleBlock>) {
    setError("");

    const response = await fetch("/api/schedule/blocks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...block,
        ...updates
      })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not move schedule block.");
      return;
    }

    window.location.reload();
  }

  function beginResize(block: ScheduleBlock, startY: number) {
    resizingRef.current = {
      block,
      startY,
      startDuration: block.durationMinutes
    };

    const onMove = (event: MouseEvent) => {
      const current = resizingRef.current;
      if (!current) {
        return;
      }

      const deltaSlots = Math.round((event.clientY - current.startY) / slotHeight);
      const durationMinutes = Math.max(15, Math.min(24 * 60, current.startDuration + deltaSlots * minutesPerSlot));
      const nextEndMinute = current.block.startMinuteOfDay + durationMinutes;
      if (nextEndMinute > 24 * 60) {
        return;
      }

      resizingRef.current = {
        ...current,
        startDuration: current.startDuration
      };
      current.block.durationMinutes = durationMinutes;
    };

    const onUp = () => {
      const current = resizingRef.current;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      resizingRef.current = null;

      if (!current) {
        return;
      }

      startTransition(() => void saveBlock(current.block, { durationMinutes: current.block.durationMinutes }));
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const visibleBlocks = blocks
    .filter((block) => block.dayOfWeek === activeDay)
    .slice()
    .sort((left, right) => left.startMinuteOfDay - right.startMinuteOfDay);

  return (
    <div className="stack-form">
      <p className="subtle">
        Drag blocks onto a new 15-minute slot and resize from the bottom edge to change duration. The editor snaps to
        quarter hours and still validates overlaps before saving. Times follow {timeZone}.
      </p>
      <div className="toggle-row" style={{ flexWrap: "wrap", gap: 8 }}>
        {dayLabels.map((label, index) => (
          <button
            className={activeDay === index ? "button" : "button secondary"}
            key={label}
            onClick={() => setActiveDay(index)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <p className="danger">{error}</p> : null}
      <div className="schedule-timeline">
        <div className="schedule-timeline-grid">
          {Array.from({ length: totalSlots }, (_, slotIndex) => {
            const minuteOfDay = slotIndex * minutesPerSlot;
            const isHour = minuteOfDay % 60 === 0;

            return (
              <div
                className={`schedule-slot${isHour ? " schedule-slot-hour" : ""}${draggedId ? " schedule-slot-active" : ""}`}
                key={minuteOfDay}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const blockId = event.dataTransfer.getData("text/plain") || draggedId;
                  const block = blocks.find((entry) => entry.id === blockId);
                  setDraggedId("");

                  if (!block || block.dayOfWeek !== activeDay) {
                    return;
                  }

                  startTransition(() => void saveBlock(block, { startMinuteOfDay: minuteOfDay }));
                }}
              >
                <div className="schedule-slot-label">{isHour ? formatMinuteOfDay(minuteOfDay) : ""}</div>
              </div>
            );
          })}
        </div>
        <div className="schedule-timeline-blocks">
          {visibleBlocks.map((block) => {
              const top = (block.startMinuteOfDay / minutesPerSlot) * slotHeight;
              const height = Math.max((block.durationMinutes / minutesPerSlot) * slotHeight - 4, 24);
              const show = showProfiles.find((entry) => entry.id === block.showId);

              return (
                <button
                  className={`schedule-block-card${conflictSet.has(block.id) ? " schedule-block-conflict" : ""}`}
                  draggable
                  key={block.id}
                  onDragEnd={() => setDraggedId("")}
                  onDragStart={(event) => {
                    setDraggedId(block.id);
                    event.dataTransfer.setData("text/plain", block.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  style={{
                    top,
                    height,
                    borderLeftColor: conflictSet.has(block.id) ? undefined : show?.color || undefined,
                    background: conflictSet.has(block.id)
                      ? undefined
                      : show?.color
                        ? `color-mix(in srgb, ${show.color} 18%, rgba(255,255,255,0.74))`
                        : undefined
                  }}
                  title={`${block.title} · ${formatMinuteOfDay(block.startMinuteOfDay)} · ${block.durationMinutes} minutes`}
                  type="button"
                >
                  <strong>{block.title}</strong>
                  {show ? <span className="schedule-show-name">{show.name}</span> : null}
                  <span>
                    {formatMinuteOfDay(block.startMinuteOfDay)} · {block.durationMinutes}m
                  </span>
                  <span>{block.sourceName}</span>
                  <span
                    className="subtle"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      beginResize({ ...block }, event.clientY);
                    }}
                    style={{
                      alignSelf: "stretch",
                      borderTop: "1px solid rgba(255,255,255,0.15)",
                      cursor: "ns-resize",
                      marginTop: "auto",
                      paddingTop: 6
                    }}
                  >
                    Resize duration
                  </span>
                </button>
              );
            })}
        </div>
      </div>
      {isPending ? <p className="subtle">Moving block...</p> : null}
    </div>
  );
}
