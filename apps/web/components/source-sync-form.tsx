"use client";

import { useState, useTransition } from "react";

export function SourceSyncForm(props: { sourceId: string; enabled: boolean }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  async function requestSync() {
    const response = await fetch("/api/sources/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: props.sourceId })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not queue a source sync.");
      return;
    }

    setMessage(payload.message ?? "Source sync queued.");
    window.location.reload();
  }

  return (
    <div className="stack-form">
      <button
        className="button secondary"
        disabled={isPending || !props.enabled}
        onClick={() => {
          setError("");
          setMessage("");
          startTransition(() => void requestSync());
        }}
        type="button"
      >
        {isPending ? "Queuing..." : "Sync now"}
      </button>
      {!props.enabled ? <div className="subtle">Enable the source before requesting a manual sync.</div> : null}
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
    </div>
  );
}
