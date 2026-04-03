"use client";

import { formatMinuteOfDay, type ScheduleBlock } from "@stream247/core";
import { useState, useTransition } from "react";

type Props = {
  pools: Array<{ id: string; name: string }>;
  block?: ScheduleBlock;
};

const dayOptions = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" }
];

export function ScheduleBlockForm({ pools, block }: Props) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const isEditing = Boolean(block);

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage("");
        setError("");

        const formData = new FormData(event.currentTarget);
        const hours = Number(formData.get("startHour") || 0);
        const minutes = Number(formData.get("startMinute") || 0);

        const payload = {
          id: String(formData.get("id") || ""),
          title: String(formData.get("title") || ""),
          categoryName: String(formData.get("categoryName") || ""),
          sourceName: "",
          poolId: String(formData.get("poolId") || ""),
          dayOfWeek: Number(formData.get("dayOfWeek") || 0),
          startMinuteOfDay: hours * 60 + minutes,
          durationMinutes: Number(formData.get("durationMinutes") || 0)
        };

        startTransition(async () => {
          const response = await fetch("/api/schedule/blocks", {
            method: isEditing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          const body = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(body.message ?? "Could not save schedule block.");
            return;
          }

          setMessage(body.message ?? "Schedule block saved.");
          window.location.reload();
        });
      }}
    >
      {block ? <input name="id" type="hidden" value={block.id} /> : null}
      <div className="form-grid">
        <label>
          <span className="label">Title</span>
          <input defaultValue={block?.title ?? ""} name="title" placeholder="Prime time mix" required />
        </label>
        <label>
          <span className="label">Category</span>
          <input defaultValue={block?.categoryName ?? ""} name="categoryName" placeholder="Music" required />
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label">Day</span>
          <select defaultValue={String(block?.dayOfWeek ?? 1)} name="dayOfWeek">
            {dayOptions.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Start hour</span>
          <select defaultValue={String(Math.floor((block?.startMinuteOfDay ?? 0) / 60))} name="startHour">
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Start minute</span>
          <select defaultValue={String((block?.startMinuteOfDay ?? 0) % 60)} name="startMinute">
            {[0, 15, 30, 45].map((minute) => (
              <option key={minute} value={minute}>
                {String(minute).padStart(2, "0")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Duration (minutes)</span>
          <input
            defaultValue={block?.durationMinutes ?? 60}
            min={15}
            name="durationMinutes"
            step={15}
            type="number"
          />
        </label>
      </div>
      <label>
        <span className="label">Pool</span>
        <select defaultValue={block?.poolId ?? ""} name="poolId" required>
          <option value="" disabled>
            Select a pool
          </option>
          {pools.map((pool) => (
            <option key={pool.id} value={pool.id}>
              {pool.name}
            </option>
          ))}
        </select>
      </label>
      {block ? <p className="subtle">Current start: {formatMinuteOfDay(block.startMinuteOfDay)}</p> : null}
      {message ? <p>{message}</p> : null}
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : isEditing ? "Update block" : "Add block"}
      </button>
    </form>
  );
}
