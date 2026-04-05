"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type PlayoutAssetOption = {
  id: string;
  title: string;
};

export function PlayoutActionForm(props: {
  assets: PlayoutAssetOption[];
  currentAssetId?: string;
  previousAssetId?: string;
  previousAssetTitle?: string;
  nextAssetId?: string;
  nextAssetTitle?: string;
  overrideMode: "schedule" | "asset" | "fallback";
  liveBridgeStatus?: "idle" | "pending" | "active" | "releasing" | "error";
  liveBridgeLabel?: string;
  liveBridgeInputType?: "" | "rtmp" | "hls";
  liveBridgeInputSummary?: string;
  liveBridgeLastError?: string;
}) {
  const [error, setError] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState(props.currentAssetId || props.assets[0]?.id || "");
  const [minutes, setMinutes] = useState("60");
  const [liveBridgeInputType, setLiveBridgeInputType] = useState<"rtmp" | "hls">(props.liveBridgeInputType === "hls" ? "hls" : "rtmp");
  const [liveBridgeUrl, setLiveBridgeUrl] = useState("");
  const [liveBridgeLabel, setLiveBridgeLabel] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function runAction(body: Record<string, unknown>) {
    setError("");
    const response = await fetch("/api/broadcast/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "Playout action failed.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="stack-form" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction({ type: "restart" }))}
          type="button"
        >
          Soft restart
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction({ type: "hard_reload" }))}
          type="button"
        >
          Hard reload
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction({ type: "refresh" }))}
          type="button"
        >
          Refresh scenes
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction({ type: "rebuild_queue" }))}
          type="button"
        >
          Rebuild queue
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction({ type: "force_reconnect" }))}
          type="button"
        >
          Force reconnect
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction({ type: "fallback" }))}
          type="button"
        >
          Temporary fallback
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction({ type: "skip", minutes: Number(minutes) || 60 }))}
          type="button"
        >
          Skip current
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || props.overrideMode === "schedule"}
          onClick={() => startTransition(() => void runAction({ type: "resume" }))}
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

      <div className="form-grid">
        <label>
          <span className="label">Live Bridge input</span>
          <select className="select" onChange={(event) => setLiveBridgeInputType(event.target.value === "hls" ? "hls" : "rtmp")} value={liveBridgeInputType}>
            <option value="rtmp">RTMP / RTMPS</option>
            <option value="hls">HLS</option>
          </select>
        </label>
        <label>
          <span className="label">Live Bridge label</span>
          <input
            maxLength={120}
            onChange={(event) => setLiveBridgeLabel(event.target.value)}
            placeholder={props.liveBridgeLabel || "Live Bridge"}
            value={liveBridgeLabel}
          />
        </label>
      </div>

      <label>
        <span className="label">Live Bridge URL</span>
        <input
          onChange={(event) => setLiveBridgeUrl(event.target.value)}
          placeholder={props.liveBridgeInputSummary ? `Stored input: ${props.liveBridgeInputSummary}` : liveBridgeInputType === "hls" ? "https://example.com/live.m3u8" : "rtmp://encoder.example.com/live/key"}
          value={liveBridgeUrl}
        />
      </label>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="button"
          disabled={isPending || !selectedAssetId}
          onClick={() =>
            startTransition(() =>
              void runAction({
                type: "override",
                assetId: selectedAssetId,
                minutes: Number(minutes) || 60
              })
            )
          }
          type="button"
        >
          Pin on air
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || !selectedAssetId}
          onClick={() =>
            startTransition(() =>
              void runAction({
                type: "play_now",
                assetId: selectedAssetId
              })
            )
          }
          type="button"
        >
          Play now
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || !selectedAssetId}
          onClick={() =>
            startTransition(() =>
              void runAction({
                type: "move_next",
                assetId: selectedAssetId
              })
            )
          }
          type="button"
        >
          Move next
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || !selectedAssetId}
          onClick={() =>
            startTransition(() =>
              void runAction({
                type: "trigger_insert",
                assetId: selectedAssetId
              })
            )
          }
          type="button"
        >
          Play insert
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || !liveBridgeUrl.trim()}
          onClick={() =>
            startTransition(() =>
              void runAction({
                type: "bridge_start",
                inputType: liveBridgeInputType,
                inputUrl: liveBridgeUrl,
                label: liveBridgeLabel
              })
            )
          }
          type="button"
        >
          Take live
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || !props.liveBridgeStatus || props.liveBridgeStatus === "idle"}
          onClick={() => startTransition(() => void runAction({ type: "bridge_release" }))}
          type="button"
        >
          Release live
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || !props.nextAssetId}
          onClick={() => startTransition(() => void runAction({ type: "remove_next" }))}
          type="button"
        >
          Remove next
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || !props.previousAssetId}
          onClick={() => startTransition(() => void runAction({ type: "replay_previous" }))}
          type="button"
        >
          Replay previous
        </button>
      </div>

      {props.nextAssetTitle ? <p className="subtle">Next queued asset: {props.nextAssetTitle}</p> : null}
      {props.previousAssetTitle ? <p className="subtle">Previous completed asset: {props.previousAssetTitle}</p> : null}
      {props.liveBridgeStatus && props.liveBridgeStatus !== "idle" ? (
        <p className="subtle">
          Live Bridge {props.liveBridgeStatus}
          {props.liveBridgeLabel ? ` · ${props.liveBridgeLabel}` : ""}
          {props.liveBridgeInputSummary ? ` · ${props.liveBridgeInputSummary}` : ""}
        </p>
      ) : null}
      {props.liveBridgeLastError ? <p className="danger">{props.liveBridgeLastError}</p> : null}
      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}
