"use client";

import type { ModerationConfig } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ModerationSettingsForm({ config }: { config: ModerationConfig }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage("");
        setError("");

        const formData = new FormData(event.currentTarget);
        const payload = {
          enabled: formData.get("enabled") === "on",
          command: String(formData.get("command") || "here"),
          defaultMinutes: Number(formData.get("defaultMinutes") || 30),
          minMinutes: Number(formData.get("minMinutes") || 5),
          maxMinutes: Number(formData.get("maxMinutes") || 240),
          requirePrefix: formData.get("requirePrefix") === "on",
          fallbackEmoteOnly: formData.get("fallbackEmoteOnly") === "on"
        };

        startTransition(async () => {
          const response = await fetch("/api/moderation/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          const body = (await response.json()) as { message?: string };

          if (!response.ok) {
            setError(body.message ?? "Could not save settings.");
            return;
          }

          setMessage(body.message ?? "Saved.");
          router.refresh();
        });
      }}
    >
      <label className="toggle-row">
        <input defaultChecked={config.enabled} name="enabled" type="checkbox" />
        <span>Enable moderator presence policy</span>
      </label>
      <label>
        <span className="label">Command keyword</span>
        <input defaultValue={config.command} name="command" required />
      </label>
      <label className="toggle-row">
        <input defaultChecked={config.requirePrefix} name="requirePrefix" type="checkbox" />
        <span>Require command prefix</span>
      </label>
      <div className="form-grid">
        <label>
          <span className="label">Default minutes</span>
          <input defaultValue={config.defaultMinutes} min={1} name="defaultMinutes" type="number" />
        </label>
        <label>
          <span className="label">Minimum minutes</span>
          <input defaultValue={config.minMinutes} min={1} name="minMinutes" type="number" />
        </label>
        <label>
          <span className="label">Maximum minutes</span>
          <input defaultValue={config.maxMinutes} min={1} name="maxMinutes" type="number" />
        </label>
      </div>
      <p className="subtle">
        Omitted durations use the default. Requests below the minimum clamp up, and requests above the maximum clamp down.
      </p>
      <label className="toggle-row">
        <input defaultChecked={config.fallbackEmoteOnly} name="fallbackEmoteOnly" type="checkbox" />
        <span>Fallback to emote-only when no moderator window is active</span>
      </label>
      {message ? <p>{message}</p> : null}
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save moderation policy"}
      </button>
    </form>
  );
}
