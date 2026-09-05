"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

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
  recoveringDestinationCount?: number;
  coolingDestinationCount?: number;
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
      {/*
        The repair actions used to sit here as six buttons of equal weight, in front of everything
        else, on the page an operator opens when something is wrong. Measured, this surface showed 33
        controls at once and no visible hierarchy among them — while a paragraph above the form
        explained, in prose, which ones to reach for first.

        That ordering is now the layout rather than a sentence: the two the guidance calls the normal
        path stay in front, the rest are one click away, and the group is closed by default so the
        everyday controls are what you see. Nothing was removed.
      */}
      <details className="disclosure">
        <summary>If something is stuck</summary>
        <p className="subtle" style={{ marginTop: 8 }}>
          Refreshing the scenes or rebuilding the queue fixes most of it, and neither interrupts what is on
          air. The rest are stronger and worth trying in the order they appear.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
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
          onClick={() => startTransition(() => void runAction({ type: "restart" }))}
          type="button"
        >
          Soft restart
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
          disabled={
            isPending ||
            !props.recoveringDestinationCount ||
            props.recoveringDestinationCount < 1 ||
            props.liveBridgeStatus === "pending" ||
            props.liveBridgeStatus === "active" ||
            props.liveBridgeStatus === "releasing"
          }
          onClick={() => startTransition(() => void runAction({ type: "recover_outputs" }))}
          type="button"
        >
          Recover outputs now
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => startTransition(() => void runAction({ type: "hard_reload" }))}
          type="button"
        >
          Hard reload
        </button>
        </div>
      </details>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

      {props.recoveringDestinationCount || props.coolingDestinationCount ? (
        <p className="subtle" style={{ marginTop: 0 }}>
          {props.recoveringDestinationCount ? `${props.recoveringDestinationCount} output(s) staged for the next transition.` : "No staged outputs."}{" "}
          {props.coolingDestinationCount ? `${props.coolingDestinationCount} output(s) are still in cooldown.` : ""}
        </p>
      ) : null}

      <div className="form-grid">
        <label>
          <span className="label label-with-info">Pin asset<InfoTip text="The asset the buttons below act on, whether you pin it on air, play it now, queue it next or run it as an insert. Starts out as whatever is on air right now." /></span>
          <select className="select" onChange={(event) => setSelectedAssetId(event.target.value)} value={selectedAssetId}>
            {props.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label label-with-info">Override minutes<InfoTip text="Used by Pin on air and Skip current: a pinned asset keeps the slot for this many minutes before the schedule takes back over, and a skipped asset stays out of the queue for the same span while the schedule carries on. Kept between 5 and 240 minutes." /></span>
          <input min="5" name="minutes" onChange={(event) => setMinutes(event.target.value)} step="5" type="number" value={minutes} />
        </label>
      </div>

      {/*
        Bringing an outside feed on air is a distinct job from steering the schedule, and a rare one
        on a channel that runs itself. Its three fields and its two buttons were spread across the
        page — the inputs in one block, "Take live" and "Release live" among the asset actions. They
        are one thing now, and closed until someone wants it.
      */}
      <details className="disclosure">
        <summary>Bring in an outside feed</summary>
        <div style={{ marginTop: 12 }}>
      <div className="form-grid">
        <label>
          <span className="label label-with-info">Live Bridge input<InfoTip text="The kind of feed the channel pulls in: RTMP takes an rtmp:// or rtmps:// address, HLS an http:// or https:// playlist. While the feed is on air the overlay's source line reads “Live Bridge · RTMP” or “Live Bridge · HLS”." /></span>
          <select className="select" onChange={(event) => setLiveBridgeInputType(event.target.value === "hls" ? "hls" : "rtmp")} value={liveBridgeInputType}>
            <option value="rtmp">RTMP / RTMPS</option>
            <option value="hls">HLS</option>
          </select>
        </label>
        <label>
          <span className="label label-with-info">Live Bridge label<InfoTip text="Shown on air as the title while the outside feed is playing, where an asset title would normally be, and in the Live Bridge status line under these buttons. Left empty it reads “Live Bridge”." /></span>
          <input
            maxLength={120}
            onChange={(event) => setLiveBridgeLabel(event.target.value)}
            placeholder={props.liveBridgeLabel || "Live Bridge"}
            value={liveBridgeLabel}
          />
        </label>
      </div>

      <label>
        <span className="label label-with-info">Live Bridge URL<InfoTip text="Where the channel pulls the outside feed from; it has to match the input type chosen above. Once taken live, this feed replaces scheduled playback until you release it, and only its protocol and host are shown back here afterwards." /></span>
        <input
          onChange={(event) => setLiveBridgeUrl(event.target.value)}
          placeholder={props.liveBridgeInputSummary ? `Stored input: ${props.liveBridgeInputSummary}` : liveBridgeInputType === "hls" ? "https://example.com/live.m3u8" : "rtmp://encoder.example.com/live/key"}
          value={liveBridgeUrl}
        />
      </label>
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
        </div>
      </details>

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
