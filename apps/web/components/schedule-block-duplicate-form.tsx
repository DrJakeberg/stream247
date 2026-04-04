"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ScheduleBlock } from "@stream247/core";

const dayOptions = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" }
];

export function ScheduleBlockDuplicateForm({ block }: { block: ScheduleBlock }) {
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage("");
        setError("");

        startTransition(async () => {
          const response = await fetch("/api/schedule/blocks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "duplicate",
              sourceBlockId: block.id,
              dayOfWeeks: selectedDays
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not duplicate schedule block.");
            return;
          }

          setSelectedDays([]);
          setMessage(payload.message ?? "Schedule block duplicated.");
          router.refresh();
        });
      }}
    >
      <div>
        <span className="label">Duplicate to weekdays</span>
        <div className="chip-grid">
          {dayOptions
            .filter((day) => day.value !== block.dayOfWeek)
            .map((day) => {
              const selected = selectedDays.includes(day.value);

              return (
                <label className={`chip-toggle${selected ? " chip-toggle-active" : ""}`} key={day.value}>
                  <input
                    checked={selected}
                    onChange={(event) => {
                      setSelectedDays((current) => {
                        if (event.target.checked) {
                          return [...current, day.value].sort((left, right) => left - right);
                        }

                        return current.filter((value) => value !== day.value);
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
      </div>
      {message ? <p>{message}</p> : null}
      {error ? <p className="danger">{error}</p> : null}
      <button className="button secondary" disabled={isPending || selectedDays.length === 0} type="submit">
        {isPending ? "Duplicating..." : "Duplicate block"}
      </button>
    </form>
  );
}
