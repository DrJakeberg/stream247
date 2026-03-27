"use client";

import { formatMinuteOfDay, type ScheduleBlock } from "@stream247/core";
import { useState, useTransition } from "react";

const minutesPerSlot = 15;
const slotHeight = 28;
const totalSlots = (24 * 60) / minutesPerSlot;

type Props = {
  blocks: ScheduleBlock[];
  conflicts: string[];
  timeZone: string;
};

export function ScheduleTimeline({ blocks, conflicts, timeZone }: Props) {
  const [draggedId, setDraggedId] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const conflictSet = new Set(conflicts);

  async function moveBlock(block: ScheduleBlock, startMinuteOfDay: number) {
    setError("");

    const response = await fetch("/api/schedule/blocks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...block,
        startMinuteOfDay
      })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not move schedule block.");
      return;
    }

    window.location.reload();
  }

  return (
    <div className="stack-form">
      <p className="subtle">
        Drag blocks onto a new 15-minute slot. The editor snaps to quarter hours and still validates overlaps before
        saving. Times follow {timeZone}.
      </p>
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

                  if (!block) {
                    return;
                  }

                  startTransition(() => void moveBlock(block, minuteOfDay));
                }}
              >
                <div className="schedule-slot-label">{isHour ? formatMinuteOfDay(minuteOfDay) : ""}</div>
              </div>
            );
          })}
        </div>
        <div className="schedule-timeline-blocks">
          {blocks
            .slice()
            .sort((left, right) => left.startMinuteOfDay - right.startMinuteOfDay)
            .map((block) => {
              const top = (block.startMinuteOfDay / minutesPerSlot) * slotHeight;
              const height = Math.max((block.durationMinutes / minutesPerSlot) * slotHeight - 4, 24);

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
                  style={{ top, height }}
                  title={`${block.title} · ${formatMinuteOfDay(block.startMinuteOfDay)} · ${block.durationMinutes} minutes`}
                  type="button"
                >
                  <strong>{block.title}</strong>
                  <span>
                    {formatMinuteOfDay(block.startMinuteOfDay)} · {block.durationMinutes}m
                  </span>
                  <span>{block.sourceName}</span>
                </button>
              );
            })}
        </div>
      </div>
      {isPending ? <p className="subtle">Moving block...</p> : null}
    </div>
  );
}
