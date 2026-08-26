"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Folded by default. These thresholds decide when the channel restarts its own processes, so the
// form repeats the same bounds the API and the shared resolver enforce and explains, per guard,
// what firing actually does — an operator changing one of these during an incident should not
// have to guess which restart they are tuning.
const BOUNDS: Array<[string, number, number, string]> = [
  ["feedAudioSilenceSeconds", 15, 3600, "silence watchdog"],
  ["feedAudioGraceSeconds", 0, 3600, "silence watchdog's settling time"],
  ["feedStallTimeoutSeconds", 15, 3600, "frozen-feed watchdog"],
  ["feedStallGraceSeconds", 30, 3600, "frozen-feed watchdog's settling time"],
  ["uplinkStallTimeoutSeconds", 15, 3600, "encoder watchdog"],
  ["uplinkStallGraceSeconds", 0, 3600, "encoder watchdog's settling time"],
  ["uplinkNoProgressRestartSeconds", 60, 7200, "never-started encoder restart"],
  ["durationBoundMarginSeconds", 5, 120, "planned end-of-video margin"]
];

export function WatchdogThresholdsForm(props: {
  initialValues: Record<(typeof BOUNDS)[number][0], string>;
  /** What an empty field resolves to: the env variable or the built-in default. All seconds. */
  fallback: Record<(typeof BOUNDS)[number][0], number>;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const field = (name: (typeof BOUNDS)[number][0], label: string) => (
    <label key={name}>
      <span className="label">{label}</span>
      <input
        defaultValue={props.initialValues[name]}
        inputMode="numeric"
        name={name}
        placeholder={`Follow the server (now: ${String(props.fallback[name])} s)`}
      />
    </label>
  );

  return (
    <details className="disclosure">
      <summary>Watchdog thresholds</summary>
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
            if (value !== "" && !(Number(value) >= min && Number(value) <= max)) {
              setError(
                `The ${label} is seconds and must sit between ${String(min)} and ${String(max)} — outside that range it would either restart a healthy channel or never fire at all.`
              );
              return;
            }
            values[name] = value;
          }

          startTransition(async () => {
            const response = await fetch("/api/settings/watchdogs", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(values)
            });
            const payload = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(payload.message ?? "Could not save the watchdog thresholds.");
              return;
            }
            setMessage(payload.message ?? "Watchdog thresholds saved.");
            router.refresh();
          });
        }}
      >
        <p className="subtle">
          Each watchdog restarts a stuck part of the channel after the fault has lasted this long.
          Lower values recover faster but must never sit below what a healthy channel looks like;
          the form and the server both refuse values outside the safe range. Empty fields follow
          the server environment or the built-in defaults. All values are seconds.
        </p>
        <p className="subtle">
          The silence watchdog restarts playback when the picture keeps moving but the sound is
          gone — the shape of a source that ran out while the video track froze on its last frame.
        </p>
        <div className="form-grid">
          {field("feedAudioSilenceSeconds", "Restart playback after sound has been gone for")}
          {field("feedAudioGraceSeconds", "Leave a fresh playback alone for")}
        </div>
        <p className="subtle">
          The frozen-feed watchdog restarts playback when the process is still running but has
          stopped producing anything at all — an input that hangs without erroring.
        </p>
        <div className="form-grid">
          {field("feedStallTimeoutSeconds", "Restart playback after the feed has stood still for")}
          {field("feedStallGraceSeconds", "Leave a fresh playback alone for")}
        </div>
        <p className="subtle">
          The encoder watchdog restarts the outgoing stream when the encoder is alive but no longer
          sending — running is not the same as working. The never-started restart covers an encoder
          that has not sent a single frame since it launched.
        </p>
        <div className="form-grid">
          {field("uplinkStallTimeoutSeconds", "Restart the encoder after its output has stood still for")}
          {field("uplinkStallGraceSeconds", "Leave a fresh encoder alone for")}
          {field("uplinkNoProgressRestartSeconds", "Restart an encoder that never sent anything after")}
        </div>
        <p className="subtle">
          The planned end-of-video margin ends a video this long after its known length, instead of
          waiting for a remote source that may never signal its end. Generous by design: cutting a
          few seconds of frozen last frame is invisible, cutting real content is not.
        </p>
        <div className="form-grid">
          {field("durationBoundMarginSeconds", "End a video this long past its known length")}
        </div>
        {error ? <p className="danger">{error}</p> : null}
        {message ? <p className="subtle">{message}</p> : null}
        <button className="button button-secondary" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save watchdog thresholds"}
        </button>
      </form>
    </details>
  );
}
