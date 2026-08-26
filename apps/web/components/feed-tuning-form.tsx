"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Folded by default. Whole numbers only — these become process arguments and schedule
// arithmetic. Bounds mirror the shared core limits the API enforces.
const BOUNDS: Array<[string, number, number, string]> = [
  ["playoutReconnectHours", 1, 720, "hours between planned reconnects"],
  ["playoutReconnectWindowSeconds", 5, 300, "seconds the reconnect pause lasts"],
  ["programFeedTargetSeconds", 1, 10, "seconds per feed segment"],
  ["programFeedListSize", 3, 120, "segments the feed window holds"],
  ["programFeedFailoverSeconds", 1, 60, "seconds before an aging feed counts as stopped"]
];

export function FeedTuningForm(props: {
  initialValues: Record<(typeof BOUNDS)[number][0], string>;
  /** What an empty field resolves to: the env variable or the built-in default. */
  fallback: Record<(typeof BOUNDS)[number][0], number>;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const field = (name: (typeof BOUNDS)[number][0], label: string, unit: string) => (
    <label key={name}>
      <span className="label">{label}</span>
      <input
        defaultValue={props.initialValues[name]}
        inputMode="numeric"
        name={name}
        placeholder={`Follow the server (now: ${String(props.fallback[name])}${unit})`}
      />
    </label>
  );

  return (
    <details className="disclosure">
      <summary>Feed tuning</summary>
      <form
        className="stack-form"
        style={{ marginTop: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setMessage("");
          const formData = new FormData(event.currentTarget);
          const values: Record<string, string> = {};
          for (const [name, min, max, label] of BOUNDS) {
            const value = String(formData.get(name) || "").trim();
            if (value !== "" && !(Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max)) {
              setError(`The ${label} must be a whole number between ${String(min)} and ${String(max)}.`);
              return;
            }
            values[name] = value;
          }

          startTransition(async () => {
            const response = await fetch("/api/settings/feed-tuning", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(values)
            });
            const payload = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(payload.message ?? "Could not save the feed tuning.");
              return;
            }
            setMessage(payload.message ?? "Feed tuning saved.");
            router.refresh();
          });
        }}
      >
        <p className="subtle">
          Long-running encoders accumulate drift, so the channel plans a short reconnect on a fixed
          cadence instead of waiting for one to be forced at a worse moment. Empty fields follow the
          server environment or the built-in defaults.
        </p>
        <div className="form-grid">
          {field("playoutReconnectHours", "Planned reconnect every (hours)", " h")}
          {field("playoutReconnectWindowSeconds", "Reconnect pause lasts (seconds)", " s")}
        </div>
        <p className="subtle">
          The program feed is the hand-off between playback and the outgoing encoder: playback
          writes short segments, the encoder reads them from a sliding window. Segment length sets
          the trade between latency and tolerance; the window times the segment length is how much
          material is buffered on disk. New values take effect from the next playback start.
        </p>
        <div className="form-grid">
          {field("programFeedTargetSeconds", "Feed segment length (seconds)", " s")}
          {field("programFeedListSize", "Feed window (segments)", "")}
          {field("programFeedFailoverSeconds", "Feed counts as stopped this long after its window empties (seconds)", " s")}
        </div>
        {error ? <p className="danger">{error}</p> : null}
        {message ? <p className="subtle">{message}</p> : null}
        <button className="button button-secondary" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save feed tuning"}
        </button>
      </form>
    </details>
  );
}
