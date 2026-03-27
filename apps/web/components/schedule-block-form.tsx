"use client";

import { formatMinuteOfDay, type ScheduleBlock } from "@stream247/core";
import { useState, useTransition } from "react";

type Props = {
  sources: string[];
  block?: ScheduleBlock;
};

export function ScheduleBlockForm({ sources, block }: Props) {
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
          sourceName: String(formData.get("sourceName") || ""),
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
        <span className="label">Preferred source</span>
        <input
          defaultValue={block?.sourceName ?? ""}
          list={block ? `schedule-sources-${block.id}` : "schedule-sources-new"}
          name="sourceName"
          placeholder="YouTube Playlist"
          required
        />
        <datalist id={block ? `schedule-sources-${block.id}` : "schedule-sources-new"}>
          {sources.map((source) => (
            <option key={source} value={source} />
          ))}
        </datalist>
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
