"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type SwitchKey = "streamChatOverlayEnabled" | "streamAlertsEnabled" | "twitchScheduleSyncEnabled" | "sourceLayerEnabled";

const SWITCHES: Array<{ key: SwitchKey; label: string; hint: string }> = [
  {
    key: "streamChatOverlayEnabled",
    label: "Chat on the stream",
    hint: "The Twitch IRC runtime behind the chat rail, viewer voting and the chat game."
  },
  {
    key: "streamAlertsEnabled",
    label: "Viewer alerts on the stream",
    hint: "EventSub notifications rendered as timed alerts: follows, subs, cheers, channel points."
  },
  {
    key: "twitchScheduleSyncEnabled",
    label: "Twitch schedule sync",
    hint: "Mirrors the weekly programme into the channel's Twitch schedule."
  },
  {
    key: "sourceLayerEnabled",
    label: "Video sources on the stream",
    hint: "Samples stored cameras or feeds and draws the picture into positioned scene layers."
  }
];

// The former deployment-only kill switches. "Follow the server" keeps whatever the environment
// decides — which is also why a fresh install behaves exactly like it did before these existed.
export function FeatureSwitchesForm(props: {
  initialValues: Record<SwitchKey, string>;
  /** What "follow the server" resolves to: the env variable or the built-in default. */
  fallback: Record<SwitchKey, boolean>;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <details className="disclosure">
      <summary>Feature switches</summary>
      <form
        className="stack-form"
        style={{ marginTop: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setMessage("");
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            const response = await fetch("/api/settings/operations", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                Object.fromEntries(SWITCHES.map(({ key }) => [key, String(formData.get(key) || "")]))
              )
            });
            const payload = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(payload.message ?? "Could not save the feature switches.");
              return;
            }
            setMessage(payload.message ?? "Feature switches saved.");
            router.refresh();
          });
        }}
      >
        <p className="subtle">
          Runtime gates the worker and the overlay obey on their next cycle. A switch set here wins over
          the server environment; on its default it follows whatever the environment decides.
        </p>
        <div className="form-grid">
          {SWITCHES.map(({ key, label, hint }) => (
            <label key={key} title={hint}>
              <span className="label">{label}</span>
              <select defaultValue={props.initialValues[key]} name={key}>
                <option value="">Follow the server (now: {props.fallback[key] ? "on" : "off"})</option>
                <option value="1">On</option>
                <option value="0">Off</option>
              </select>
            </label>
          ))}
        </div>
        {error ? <p className="danger">{error}</p> : null}
        {message ? <p className="subtle">{message}</p> : null}
        <button className="button button-secondary" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save feature switches"}
        </button>
      </form>
    </details>
  );
}
