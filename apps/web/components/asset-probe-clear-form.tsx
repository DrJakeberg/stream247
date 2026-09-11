"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";

/**
 * The way back for an item automatic programming has stopped choosing.
 *
 * Rendered only while the item is quarantined, because a button that does nothing on every other asset
 * page is worse than no button. Clearing the count is not a claim that the item works — it puts the item
 * back in rotation and lets the next probe decide, which is exactly what an operator wants after fixing
 * the source or replacing the file.
 */
export function AssetProbeClearForm(props: { assetId: string; failures: number }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  const { pushToast } = useToast();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(async () => {
          const response = await fetch(`/api/assets/${encodeURIComponent(props.assetId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clearPlaybackProbeFailures: true })
          });
          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            const nextError = payload.message ?? "Could not clear the probe failures.";
            setError(nextError);
            pushToast({ title: "Probe failures could not be cleared.", description: nextError, tone: "error" });
            return;
          }
          pushToast({ title: payload.message ?? "Playback probe failures cleared.", tone: "success" });
          router.refresh();
        });
      }}
    >
      <div className="item">
        <strong>
          Skipped after {props.failures} failed probes
          <InfoTip text="Automatic programming passes this item over because its last probes failed. Clearing the count puts it back in rotation immediately; the next probe decides again, so clear it after the source is fixed or the file replaced. A probe that succeeds on its own clears the count too." />
        </strong>
        <div className="subtle">
          The item stays in the library and keeps its programming flag. Only automatic selection skips it.
        </div>
        {error ? <p className="danger">{error}</p> : null}
        <button className="button secondary" disabled={isPending} type="submit">
          {isPending ? "Clearing…" : "Clear probe failures and retry"}
        </button>
      </div>
    </form>
  );
}
