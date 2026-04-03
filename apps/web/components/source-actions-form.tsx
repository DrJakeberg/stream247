"use client";

import { useState, useTransition } from "react";
import type { SourceRecord } from "@/lib/server/state";

export function SourceActionsForm(props: { source: SourceRecord }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function updateSource(enabled: boolean) {
    const response = await fetch("/api/sources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: props.source.id,
        name: props.source.name,
        connectorKind: props.source.connectorKind,
        externalUrl: props.source.externalUrl || "",
        enabled
      })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update source.");
      return;
    }
    window.location.reload();
  }

  async function deleteSource() {
    const response = await fetch("/api/sources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: props.source.id })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not delete source.");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="stack-form">
      <div className="toggle-row">
        <button
          className="button secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void updateSource(!(props.source.enabled ?? true)))}
          type="button"
        >
          {props.source.enabled ?? true ? "Disable" : "Enable"}
        </button>
        <button
          className="button secondary"
          disabled={isPending}
          onClick={() => {
            if (
              window.confirm(
                `Delete source ${props.source.name}? Its ingested assets will be removed. Sources that are still used by pools or schedule blocks can no longer be deleted until those references are removed.`
              )
            ) {
              startTransition(() => void deleteSource());
            }
          }}
          type="button"
        >
          Delete
        </button>
      </div>
      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}
