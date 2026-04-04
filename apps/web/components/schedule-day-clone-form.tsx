"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const dayOptions = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" }
];

export function ScheduleDayCloneForm() {
  const [sourceDayOfWeek, setSourceDayOfWeek] = useState(1);
  const [targetDayOfWeeks, setTargetDayOfWeeks] = useState<number[]>([2, 3, 4, 5]);
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
              action: "clone-day",
              sourceDayOfWeek,
              targetDayOfWeeks
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not clone programming day.");
            return;
          }

          setMessage(payload.message ?? "Programming day cloned.");
          router.refresh();
        });
      }}
    >
      <label>
        <span className="label">Clone this weekday</span>
        <select
          onChange={(event) => {
            const nextSourceDay = Number(event.target.value);
            setSourceDayOfWeek(nextSourceDay);
            setTargetDayOfWeeks((current) => current.filter((day) => day !== nextSourceDay));
          }}
          value={sourceDayOfWeek}
        >
          {dayOptions.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <span className="label">Onto these weekdays</span>
        <div className="chip-grid">
          {dayOptions
            .filter((day) => day.value !== sourceDayOfWeek)
            .map((day) => {
              const selected = targetDayOfWeeks.includes(day.value);

              return (
                <label className={`chip-toggle${selected ? " chip-toggle-active" : ""}`} key={day.value}>
                  <input
                    checked={selected}
                    onChange={(event) => {
                      setTargetDayOfWeeks((current) => {
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
      <p className="subtle">For safety this only clones onto empty target weekdays. Existing days must be cleared first.</p>
      {message ? <p>{message}</p> : null}
      {error ? <p className="danger">{error}</p> : null}
      <button className="button secondary" disabled={isPending || targetDayOfWeeks.length === 0} type="submit">
        {isPending ? "Cloning..." : "Clone programming day"}
      </button>
    </form>
  );
}
