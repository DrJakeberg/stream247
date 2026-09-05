"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * How loud an embedded video source is inside the programme (M57 stage 2, Etappe E).
 *
 * The value has been a managed setting since stage D with no way to set it; this is the field. It
 * carries the honest caveat next to it, because the invariant behind it is invisible from the
 * outside: a live source's sound is only mixed into items whose length is known in advance, so on
 * anything else an operator sees a live camera and hears nothing, and without this sentence that
 * reads as a fault rather than as the safety rule it is.
 *
 * Folded like every other group in the operations panel: set once, then left alone.
 */
const MIN_PERCENT = 0;
const MAX_PERCENT = 200;

export function SourceLiveSoundForm(props: {
  initialValue: string;
  /** What an empty field resolves to: the server environment or the built-in default. */
  fallback: number;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <details className="disclosure">
      <summary>Sound from live video sources</summary>
      <form
        className="stack-form"
        style={{ marginTop: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setMessage("");
          const formData = new FormData(event.currentTarget);
          const value = String(formData.get("sourceLiveGainPercent") || "").trim();
          // The same bound the route enforces and the resolver clamps to, checked here first so a
          // typo is answered without a round trip. Empty means follow the server environment.
          if (
            value !== "" &&
            !(Number.isInteger(Number(value)) && Number(value) >= MIN_PERCENT && Number(value) <= MAX_PERCENT)
          ) {
            setError(
              `Loudness is a whole percent of the programme's level, from ${String(MIN_PERCENT)} to ${String(MAX_PERCENT)}.`
            );
            return;
          }

          startTransition(async () => {
            const response = await fetch("/api/settings/operations", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sourceLiveGainPercent: value })
            });
            const payload = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(payload.message ?? "Could not save the source loudness.");
              return;
            }
            setMessage(payload.message ?? "Source loudness saved.");
            router.refresh();
          });
        }}
      >
        <p className="subtle">
          When a camera is embedded into the picture, this decides how far its sound sits under or over
          what is already playing. Zero embeds it silently; anything above a hundred puts it louder than
          the programme.
        </p>
        <div className="form-grid">
          <label>
            <span className="label label-with-info">How loud the embedded source is, relative to the programme<InfoTip text="A gain on the camera's own sound before it is mixed with the programme: 100 passes it through as it arrives, 0 embeds the picture silently, 200 doubles it. Empty follows the server setting; a change takes effect from the next item, not the one playing." /></span>
            <input
              defaultValue={props.initialValue}
              inputMode="numeric"
              max={MAX_PERCENT}
              min={MIN_PERCENT}
              name="sourceLiveGainPercent"
              placeholder={`Follow the server (now: ${String(props.fallback)}%)`}
              type="number"
            />
          </label>
        </div>
        <p className="subtle">
          Sound only travels with a camera on items whose length is known in advance. On anything else —
          a stream with no end time, a feed of unknown length — the camera is embedded as picture only,
          on purpose: the watchdog that notices silence has to stay the safety net there, and it cannot
          do that while a camera is feeding the mix.
        </p>
        {error ? <p className="danger">{error}</p> : null}
        {message ? <p className="subtle">{message}</p> : null}
        <button className="button button-secondary" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save source loudness"}
        </button>
      </form>
    </details>
  );
}
