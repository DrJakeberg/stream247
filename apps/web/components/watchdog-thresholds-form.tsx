"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

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

  const field = (name: (typeof BOUNDS)[number][0], label: string, info: string) => (
    <label key={name}>
      <span className="label label-with-info">
        {label}
        <InfoTip text={info} />
      </span>
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
          {field(
            "feedAudioSilenceSeconds",
            "Restart playback after sound has been gone for",
            "Cuts the item on air and lets the schedule choose again once the picture has kept moving this long with no sound, the shape of a source that ran out on a frozen last frame. Only a feed that has not carried any sound yet is exempt: a silent item that follows one with sound is cut when the timer runs out."
          )}
          {field(
            "feedAudioGraceSeconds",
            "Leave a fresh playback alone for",
            "Counted from each playout start, so from every item change: for this long the silence check stays quiet, giving the new item time to put out its first sound before it is judged."
          )}
        </div>
        <p className="subtle">
          The frozen-feed watchdog restarts playback when the process is still running but has
          stopped producing anything at all — an input that hangs without erroring.
        </p>
        <div className="form-grid">
          {field(
            "feedStallTimeoutSeconds",
            "Restart playback after the feed has stood still for",
            "Cuts the item on air and lets the schedule choose again when the playout process is still running but the program feed has not advanced for this long, an input that hangs without failing. Nothing fires while no playout process is running."
          )}
          {field(
            "feedStallGraceSeconds",
            "Leave a fresh playback alone for",
            "Counted from the start of the playout: for this long a still feed is not blamed on the new process, which has had no time to produce anything yet."
          )}
        </div>
        <p className="subtle">
          The encoder watchdog restarts the outgoing stream when the encoder is alive but no longer
          sending — running is not the same as working. The never-started restart covers an encoder
          that has not sent a single frame since it launched.
        </p>
        <div className="form-grid">
          {field(
            "uplinkStallTimeoutSeconds",
            "Restart the encoder after its output has stood still for",
            "Restarts the encoder when it is still running but its output has stopped advancing for this long. While the encoder reads the program feed (the default input mode) the check is skipped while that feed itself is stale, so a playback outage cannot turn into a chain of encoder restarts."
          )}
          {field(
            "uplinkStallGraceSeconds",
            "Leave a fresh encoder alone for",
            "Counted from the encoder's start: for this long the checks on the encoder's own output stay quiet - stalled output, never encoded a frame, timeline discontinuities - giving it time to probe the feed and connect to the destination. The restart that fires when every destination sits in error state is not held back by this."
          )}
          {field(
            "uplinkNoProgressRestartSeconds",
            "Restart an encoder that never sent anything after",
            "Restarts an encoder that has run this long without encoding a single frame, meaning nothing has reached the destination since it started. Kept long on purpose: a slow connect or a reconnecting destination must have time to resolve first."
          )}
        </div>
        <p className="subtle">
          The planned end-of-video margin ends a video this long after its known length, instead of
          waiting for a remote source that may never signal its end. Generous by design: cutting a
          few seconds of frozen last frame is invisible, cutting real content is not.
        </p>
        <div className="form-grid">
          {field(
            "durationBoundMarginSeconds",
            "End a video this long past its known length",
            "Ends the video deliberately and moves on once it has run this long past its known length, so a source that never signals its end is not left showing a frozen last frame. Applies only to items with a known length; live input is never cut."
          )}
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
