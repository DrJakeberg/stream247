"use client";

import { useState, useTransition } from "react";

type PlayoutAssetOption = {
  id: string;
  title: string;
};

export function PlayoutActionForm(props: {
  assets: PlayoutAssetOption[];
  currentAssetId?: string;
  overrideMode: "schedule" | "asset" | "fallback";
}) {
  const [error, setError] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState(props.currentAssetId || props.assets[0]?.id || "");
  const [minutes, setMinutes] = useState("60");
  const [isPending, startTransition] = useTransition();

  async function runAction(path: string, body?: Record<string, unknown>) {
    setError("");
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "Playout action failed.");
      return;
    }

    window.location.reload();
  }

  return (
    <div className="stack-form" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction("/api/playout/restart"))}
          type="button"
        >
          Restart encoder
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction("/api/playout/fallback"))}
          type="button"
        >
          Temporary fallback
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction("/api/playout/skip", { minutes: Number(minutes) || 60 }))}
          type="button"
        >
          Skip current
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || props.overrideMode === "schedule"}
          onClick={() => startTransition(() => void runAction("/api/playout/resume"))}
          type="button"
        >
          Resume schedule
        </button>
      </div>

      <div className="form-grid">
        <label>
          <span className="label">Pin asset</span>
          <select className="select" onChange={(event) => setSelectedAssetId(event.target.value)} value={selectedAssetId}>
            {props.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Override minutes</span>
          <input min="5" name="minutes" onChange={(event) => setMinutes(event.target.value)} step="5" type="number" value={minutes} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="button"
          disabled={isPending || !selectedAssetId}
          onClick={() =>
            startTransition(() =>
              void runAction("/api/playout/override", {
                assetId: selectedAssetId,
                minutes: Number(minutes) || 60
              })
            )
          }
          type="button"
        >
          Pin on air
        </button>
      </div>

      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}
