"use client";

import { useState, useTransition } from "react";
import type { OverlaySettingsRecord } from "@/lib/server/state";

export function OverlaySettingsForm(props: { overlay: OverlaySettingsRecord }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

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
              accentColor: String(formData.get("accentColor") || ""),
              showClock: formData.get("showClock") === "on",
              showNextItem: formData.get("showNextItem") === "on",
              showScheduleTeaser: formData.get("showScheduleTeaser") === "on",
              emergencyBanner: String(formData.get("emergencyBanner") || "")
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not save overlay settings.");
            return;
          }

          setMessage(payload.message ?? "Overlay settings updated.");
          window.location.reload();
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
          <span className="label">Accent color</span>
          <input defaultValue={props.overlay.accentColor} name="accentColor" required />
        </label>
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
      </div>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save overlay"}
      </button>
    </form>
  );
}
