"use client";

import { OVERLAY_SCENE_PRESETS } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { OverlaySettingsRecord } from "@/lib/server/state";

export function OverlaySettingsForm(props: { overlay: OverlaySettingsRecord }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [scenePreset, setScenePreset] = useState(props.overlay.scenePreset);
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");

        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const response = await fetch("/api/overlay", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: formData.get("enabled") === "on",
              channelName: String(formData.get("channelName") || ""),
              headline: String(formData.get("headline") || ""),
              scenePreset: String(formData.get("scenePreset") || props.overlay.scenePreset),
              accentColor: String(formData.get("accentColor") || ""),
              showClock: formData.get("showClock") === "on",
              showNextItem: formData.get("showNextItem") === "on",
              showScheduleTeaser: formData.get("showScheduleTeaser") === "on",
              showCurrentCategory: formData.get("showCurrentCategory") === "on",
              showSourceLabel: formData.get("showSourceLabel") === "on",
              showQueuePreview: formData.get("showQueuePreview") === "on",
              queuePreviewCount: Number(formData.get("queuePreviewCount") || props.overlay.queuePreviewCount || 3),
              emergencyBanner: String(formData.get("emergencyBanner") || ""),
              replayLabel: String(formData.get("replayLabel") || "")
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not save overlay settings.");
            return;
          }

          setMessage(payload.message ?? "Overlay settings updated.");
          router.refresh();
        });
      }}
    >
      <div className="toggle-row">
        <input defaultChecked={props.overlay.enabled} id="overlay-enabled" name="enabled" type="checkbox" />
        <label htmlFor="overlay-enabled">Enable browser-source overlay</label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label">Channel name</span>
          <input defaultValue={props.overlay.channelName} name="channelName" required />
        </label>
        <label>
          <span className="label">Headline</span>
          <input defaultValue={props.overlay.headline} name="headline" required />
        </label>
        <label>
          <span className="label">Replay label</span>
          <input defaultValue={props.overlay.replayLabel} name="replayLabel" required />
        </label>
        <label>
          <span className="label">Accent color</span>
          <input defaultValue={props.overlay.accentColor} name="accentColor" required />
        </label>
      </div>
      <label>
        <span className="label">Active scene preset</span>
        <select name="scenePreset" onChange={(event) => setScenePreset(event.target.value as OverlaySettingsRecord["scenePreset"])} value={scenePreset}>
          {OVERLAY_SCENE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <div className="preset-grid">
        {OVERLAY_SCENE_PRESETS.map((preset) => (
          <button
            className={`preset-card${preset.id === scenePreset ? " preset-card-active" : ""}`}
            key={preset.id}
            onClick={() => setScenePreset(preset.id)}
            type="button"
          >
            <strong>{preset.label}</strong>
            <div className="subtle">{preset.description}</div>
          </button>
        ))}
      </div>
      <label>
        <span className="label">Emergency banner</span>
        <input defaultValue={props.overlay.emergencyBanner} name="emergencyBanner" placeholder="Optional urgent message" />
      </label>
      <div className="form-grid">
        <label className="toggle-row">
          <input defaultChecked={props.overlay.showClock} name="showClock" type="checkbox" />
          <span>Show clock</span>
        </label>
        <label className="toggle-row">
          <input defaultChecked={props.overlay.showNextItem} name="showNextItem" type="checkbox" />
          <span>Show next item</span>
        </label>
        <label className="toggle-row">
          <input defaultChecked={props.overlay.showScheduleTeaser} name="showScheduleTeaser" type="checkbox" />
          <span>Show schedule teaser</span>
        </label>
        <label className="toggle-row">
          <input defaultChecked={props.overlay.showCurrentCategory} name="showCurrentCategory" type="checkbox" />
          <span>Show current category</span>
        </label>
        <label className="toggle-row">
          <input defaultChecked={props.overlay.showSourceLabel} name="showSourceLabel" type="checkbox" />
          <span>Show source label</span>
        </label>
        <label className="toggle-row">
          <input defaultChecked={props.overlay.showQueuePreview} name="showQueuePreview" type="checkbox" />
          <span>Show queue preview</span>
        </label>
        <label>
          <span className="label">Queue preview count</span>
          <input defaultValue={props.overlay.queuePreviewCount} max={5} min={1} name="queuePreviewCount" type="number" />
        </label>
      </div>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save overlay"}
      </button>
    </form>
  );
}
