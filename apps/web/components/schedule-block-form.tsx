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
import { InfoTip } from "@/components/ui/InfoTip";
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
          <span className="label label-with-info">
            Show profile
            <InfoTip text="Choosing one copies its name, category and default length into Title, Category and Duration, which you can still edit, and paints the block in the profile's colour in the timeline. Pick No show profile to fill the fields by hand; the profile itself has no effect on air." />
          </span>
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
          <span className="label label-with-info">
            Title
            <InfoTip text="Names the block in the schedule and, when Twitch schedule sync is on, the entry in the channel's Twitch schedule. On the overlay and in the Twitch stream title the playing video's own title comes first; this one appears only when there is no video title to show, such as on standby." />
          </span>
          <input name="title" onChange={(event) => setTitle(event.target.value)} placeholder="Prime time mix" required value={title} />
        </label>
        <label>
          <span className="label label-with-info">
            Category
            <InfoTip text="Shown in the overlay while the block runs, ahead of the video's own category. On Twitch it becomes the stream category while the playing video has none of its own, and names the schedule entry's category when Twitch schedule sync is on; a name Twitch does not know leaves the channel's default category in place." />
          </span>
          <input name="categoryName" onChange={(event) => setCategoryName(event.target.value)} placeholder="Music" required value={categoryName} />
        </label>
      </div>
      <div className="form-grid">
        {isEditing ? (
          <>
            <label>
              <span className="label label-with-info">
                Day
                <InfoTip text="Moves this occurrence to another weekday. It is locked while Apply to repeat set is on, because each copy keeps its own day; saving with that toggle off detaches this occurrence from its set whether or not the day changed." />
              </span>
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
                <span>
                  {applyToRepeatSet ? "Apply to repeat set" : "Edit only this occurrence"}
                  <InfoTip text="On, the saved title, category, show profile, time, length, pool and timed inserts reach every weekday in this repeat set, each copy keeping its own day. Off, only this occurrence changes and it leaves the set." />
                </span>
              </label>
            ) : null}
          </>
        ) : (
          <>
            <label>
              <span className="label label-with-info">
                Repeat behavior
                <InfoTip text="Creates one copy of this block for each weekday in the chosen pattern and links the copies as a repeat set, so a later edit can reach all of them at once. Single day makes one block on its own." />
              </span>
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
                <span className="label label-with-info">
                  Weekday
                  <InfoTip text="Puts the block on this one day of the week, in the channel's time zone. Choose another repeat behavior to place it on several days." />
                </span>
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
                <span className="label label-with-info">
                  Custom weekdays
                  <InfoTip text="Creates one copy of the block for every day ticked here, all sharing the same start, length and pool; two or more days are linked as a repeat set. At least one day stays selected." />
                </span>
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
          <span className="label label-with-info">
            Start hour
            <InfoTip text="Sets the hour the block goes on air, in the channel's time zone. Together with the length it must not overlap another block on the same day; an overlap is refused when you save." />
          </span>
          <select defaultValue={String(Math.floor((block?.startMinuteOfDay ?? 0) / 60))} name="startHour">
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label label-with-info">
            Start minute
            <InfoTip text="Fine-tunes the start in quarter-hour steps. The same start applies to every weekday the block repeats on." />
          </span>
          <select defaultValue={String((block?.startMinuteOfDay ?? 0) % 60)} name="startMinute">
            {[0, 15, 30, 45].map((minute) => (
              <option key={minute} value={minute}>
                {String(minute).padStart(2, "0")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label label-with-info">
            Duration (minutes)
            <InfoTip text="Keeps the block on air for this long, from 15 minutes up to a full day in quarter-hour steps; it may run past midnight. Timed inserts set beyond this length are dropped, and Twitch schedule entries are only created for blocks between 30 minutes and 23 hours." />
          </span>
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
        <span className="label label-with-info">
          Pool
          <InfoTip text="Where the playout takes its videos from while this block is on air; the pool's automatic insert keeps running inside the block. The overlay names the pool as the source, using the name it had when the block was last saved." />
        </span>
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
          <span className="label label-with-info">
            Timed insert
            <InfoTip text="The video queued when one of the times below is reached, instead of the pool's own insert video. Only ready videos are offered, and one that is excluded from programming is skipped when its time comes; leave it on the pool's choice to reuse whatever the pool already inserts." />
          </span>
          <select defaultValue={block?.cuepointAssetId ?? ""} name="cuepointAssetId">
            <option value="">Use whatever the pool inserts</option>
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
          <span className="label label-with-info">
            Play it at (seconds into the block)
            <InfoTip text="Times at which the insert is queued, separated by commas, spaces or semicolons; each fires in the next gap between two videos rather than by cutting one, once per airing unless the block runs past midnight, when its earlier times re-arm at 00:00. Times under 15 seconds or at or past the end of the block are dropped, only the earliest 24 are kept, and an insert must be chosen here or on the pool." />
          </span>
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
