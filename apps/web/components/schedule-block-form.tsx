"use client";

import {
  SCHEDULE_REPEAT_MODE_OPTIONS,
  formatMinuteOfDay,
  getRepeatDaysForMode,
  parseCuepointOffsetsString,
  summarizeCuepointOffsets,
  type ScheduleBlock,
  type ScheduleRepeatMode
} from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import type { ShowProfileRecord } from "@/lib/server/state";

type Props = {
  pools: Array<{ id: string; name: string }>;
  assets: Array<{ id: string; title: string; status: string }>;
  shows: ShowProfileRecord[];
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

export function ScheduleBlockForm({ pools, assets, shows, block }: Props) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [selectedDays, setSelectedDays] = useState<number[]>(block ? [block.dayOfWeek] : [1]);
  const [repeatMode, setRepeatMode] = useState<ScheduleRepeatMode>(block?.repeatMode ?? (block ? "single" : "weekdays"));
  const [selectedShowId, setSelectedShowId] = useState(block?.showId ?? "");
  const [title, setTitle] = useState(block?.title ?? "");
  const [categoryName, setCategoryName] = useState(block?.categoryName ?? "");
  const [durationMinutes, setDurationMinutes] = useState(block?.durationMinutes ?? 60);
  const [cuepointOffsetsText, setCuepointOffsetsText] = useState(
    summarizeCuepointOffsets(block?.cuepointOffsetsSeconds ?? [])
  );
  const [applyToRepeatSet, setApplyToRepeatSet] = useState(Boolean(block?.repeatGroupId));
  const router = useRouter();
  const { pushToast } = useToast();

  const isEditing = Boolean(block);
  const resolvedCreateDays = isEditing
    ? [block?.dayOfWeek ?? 1]
    : repeatMode === "custom"
      ? selectedDays
      : getRepeatDaysForMode(repeatMode, selectedDays[0] ?? 1, selectedDays);

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        const formData = new FormData(event.currentTarget);
        const hours = Number(formData.get("startHour") || 0);
        const minutes = Number(formData.get("startMinute") || 0);

        const payload = {
          id: String(formData.get("id") || ""),
          title: String(formData.get("title") || ""),
          categoryName: String(formData.get("categoryName") || ""),
          sourceName: "",
          showId: String(formData.get("showId") || ""),
          poolId: String(formData.get("poolId") || ""),
          dayOfWeek: Number(formData.get("dayOfWeek") || 0),
          dayOfWeeks: isEditing ? undefined : resolvedCreateDays,
          startMinuteOfDay: hours * 60 + minutes,
          durationMinutes: Number(formData.get("durationMinutes") || 0),
          repeatMode,
          applyToRepeatSet: isEditing ? applyToRepeatSet : false,
          cuepointAssetId: String(formData.get("cuepointAssetId") || ""),
          cuepointOffsetsSeconds: parseCuepointOffsetsString(String(formData.get("cuepointOffsetsText") || ""), Number(formData.get("durationMinutes") || 0))
        };

        startTransition(async () => {
          const response = await fetch("/api/schedule/blocks", {
            method: isEditing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          const body = (await response.json()) as { message?: string };
          if (!response.ok) {
            const nextError = body.message ?? "Could not save schedule block.";
            setError(nextError);
            pushToast({ title: "Schedule block could not be saved.", description: nextError, tone: "error" });
            return;
          }

          pushToast({ title: body.message ?? "Schedule block saved.", tone: "success" });
          router.refresh();
        });
      }}
    >
      {block ? <input name="id" type="hidden" value={block.id} /> : null}
      <div className="form-grid">
        <label>
          <span className="label">Show profile</span>
          <select
            name="showId"
            onChange={(event) => {
              const nextId = event.target.value;
              setSelectedShowId(nextId);
              const nextShow = shows.find((show) => show.id === nextId);
              if (nextShow) {
                setTitle(nextShow.name);
                setCategoryName(nextShow.categoryName);
                setDurationMinutes(nextShow.defaultDurationMinutes);
              }
            }}
            value={selectedShowId}
          >
            <option value="">No show profile</option>
            {shows.map((show) => (
              <option key={show.id} value={show.id}>
                {show.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Title</span>
          <input name="title" onChange={(event) => setTitle(event.target.value)} placeholder="Prime time mix" required value={title} />
        </label>
        <label>
          <span className="label">Category</span>
          <input name="categoryName" onChange={(event) => setCategoryName(event.target.value)} placeholder="Music" required value={categoryName} />
        </label>
      </div>
      <div className="form-grid">
        {isEditing ? (
          <>
            <label>
              <span className="label">Day</span>
              <select defaultValue={String(block?.dayOfWeek ?? 1)} disabled={applyToRepeatSet} name="dayOfWeek">
                {dayOptions.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </label>
            {block?.repeatGroupId ? (
              <label className={`chip-toggle${applyToRepeatSet ? " chip-toggle-active" : ""}`} style={{ alignSelf: "end" }}>
                <input
                  checked={applyToRepeatSet}
                  onChange={(event) => setApplyToRepeatSet(event.target.checked)}
                  type="checkbox"
                />
                <span>{applyToRepeatSet ? "Apply to repeat set" : "Edit only this occurrence"}</span>
              </label>
            ) : null}
          </>
        ) : (
          <>
            <label>
              <span className="label">Repeat behavior</span>
              <select
                onChange={(event) => {
                  const nextMode = event.target.value as ScheduleRepeatMode;
                  setRepeatMode(nextMode);
                  if (nextMode !== "custom") {
                    setSelectedDays(getRepeatDaysForMode(nextMode, selectedDays[0] ?? 1, selectedDays));
                  }
                }}
                value={repeatMode}
              >
                {SCHEDULE_REPEAT_MODE_OPTIONS.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            {repeatMode === "single" ? (
              <label>
                <span className="label">Weekday</span>
                <select
                  onChange={(event) => setSelectedDays([Number(event.target.value)])}
                  value={String(selectedDays[0] ?? 1)}
                >
                  {dayOptions.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {repeatMode === "custom" ? (
              <label style={{ gridColumn: "1 / -1" }}>
                <span className="label">Custom weekdays</span>
                <div className="chip-grid">
                  {dayOptions.map((day) => {
                    const selected = selectedDays.includes(day.value);
                    return (
                      <label className={`chip-toggle${selected ? " chip-toggle-active" : ""}`} key={day.value}>
                        <input
                          checked={selected}
                          name="dayOfWeeks"
                          onChange={(event) => {
                            setSelectedDays((current) => {
                              if (event.target.checked) {
                                return [...current, day.value].sort((left, right) => left - right);
                              }

                              const next = current.filter((value) => value !== day.value);
                              return next.length > 0 ? next : current;
                            });
                          }}
                          type="checkbox"
                          value={day.value}
                        />
                        <span>{day.label}</span>
                      </label>
                    );
                  })}
                </div>
              </label>
            ) : null}
          </>
        )}
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
            min={15}
            name="durationMinutes"
            onChange={(event) => setDurationMinutes(Number(event.target.value || 0))}
            step={15}
            type="number"
            value={durationMinutes}
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
      <div className="form-grid">
        <label>
          <span className="label">Cuepoint insert asset</span>
          <select defaultValue={block?.cuepointAssetId ?? ""} name="cuepointAssetId">
            <option value="">Use pool automatic insert asset</option>
            {assets
              .filter((asset) => asset.status === "ready")
              .map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span className="label">Cuepoints (seconds from block start)</span>
          <input
            name="cuepointOffsetsText"
            onChange={(event) => setCuepointOffsetsText(event.target.value)}
            placeholder="600, 1800, 2700"
            value={cuepointOffsetsText}
          />
        </label>
      </div>
      {block ? (
        <p className="subtle">
          Current start: {formatMinuteOfDay(block.startMinuteOfDay)}
          {block.repeatGroupId
            ? applyToRepeatSet
              ? " · Updating applies to the full repeat set."
              : " · Saving detaches this occurrence from its repeat set."
            : ""}
        </p>
      ) : (
        <p className="subtle">
          New blocks can be created as single blocks or explicit repeat sets. Show profiles prefill title, category, and duration.
        </p>
      )}
      <p className="subtle">
        Cuepoints trigger safe-boundary inserts after the configured second offset has passed. They never cut the current asset mid-file.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : isEditing ? "Update block" : "Add block"}
      </button>
    </form>
  );
}
