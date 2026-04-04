"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { SourceRecord } from "@/lib/server/state";

export function SourceBulkActionsForm({ sources }: { sources: SourceRecord[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const selectedSources = useMemo(
    () => sources.filter((source) => selectedIds.includes(source.id)),
    [selectedIds, sources]
  );

  async function submit(action: "enable" | "disable" | "sync") {
    const response = await fetch("/api/sources/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sourceIds: selectedIds })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not apply bulk action.");
      return;
    }

    setMessage(payload.message ?? "Bulk source action applied.");
    setSelectedIds([]);
    router.refresh();
  }

  function toggleSource(sourceId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...current, sourceId].sort((left, right) => left.localeCompare(right)) : current.filter((id) => id !== sourceId)
    );
  }

  return (
    <div className="stack-form">
      <p className="subtle">
        Select multiple sources to enable, disable, or queue a sync in one operator action.
      </p>
      <div className="chip-grid">
        {sources.map((source) => {
          const selected = selectedIds.includes(source.id);
          return (
            <label className={`chip-toggle${selected ? " chip-toggle-active" : ""}`} key={source.id}>
              <input checked={selected} onChange={(event) => toggleSource(source.id, event.target.checked)} type="checkbox" />
              <span>
                {source.name} · {source.enabled ?? true ? "enabled" : "disabled"}
              </span>
            </label>
          );
        })}
      </div>
      <div className="subtle">
        {selectedSources.length > 0
          ? `Selected ${selectedSources.length} source(s): ${selectedSources.map((source) => source.name).join(", ")}`
          : "No sources selected yet."}
      </div>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <div className="toggle-row">
        <button
          className="button"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void submit("sync"));
          }}
          type="button"
        >
          {isPending ? "Applying..." : "Sync selected"}
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void submit("enable"));
          }}
          type="button"
        >
          Enable selected
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void submit("disable"));
          }}
          type="button"
        >
          Disable selected
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            setSelectedIds([]);
          }}
          type="button"
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}
