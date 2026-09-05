"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

type SwitchKey =
  | "streamChatOverlayEnabled"
  | "streamAlertsEnabled"
  | "twitchScheduleSyncEnabled"
  | "sourceLayerEnabled"
  | "sourceLiveEnabled";

const SWITCHES: Array<{ key: SwitchKey; label: string; hint: string; info: string }> = [
  {
    key: "streamChatOverlayEnabled",
    label: "Chat on the stream",
    hint: "The Twitch IRC runtime behind the chat rail, viewer voting and the chat game.",
    info: "Off takes the chat rail off the stream whatever the Engagement settings say; viewer voting, requests, moderation and the chat game are not behind this switch and keep the Twitch chat connection open while they are on. Follow the server uses the value shown beside it."
  },
  {
    key: "streamAlertsEnabled",
    label: "Viewer alerts on the stream",
    hint: "EventSub notifications rendered as timed alerts: follows, subs, cheers, channel points.",
    info: "Off stops follow, sub, cheer, donation and channel-point alerts from being received or drawn on the stream. It can only veto: alerts must also be turned on in the Engagement settings on the Overlays page."
  },
  {
    key: "twitchScheduleSyncEnabled",
    label: "Twitch schedule sync",
    hint: "Mirrors the weekly programme into the channel's Twitch schedule.",
    info: "Off stops the worker from writing the weekly programme into the channel's Twitch schedule and closes the schedule-sync failure incident; entries already on Twitch stay, as does any incident about blocks Twitch could not take. On resumes syncing on the next cycle; Follow the server uses the value shown beside it."
  },
  {
    key: "sourceLayerEnabled",
    label: "Video sources on the stream",
    hint: "Samples stored cameras or feeds and draws the picture into positioned scene layers.",
    info: "Off stops the worker from sampling stored cameras and feeds, so source layers in the scene draw nothing. On runs short captures inside the playout at the channel-wide snapshot interval (5 seconds unless set otherwise), which is why the built-in default is off; Follow the server uses the value shown beside it."
  },
  {
    key: "sourceLiveEnabled",
    label: "Live video from sources",
    hint: "Allows a pushed camera to become live picture and sound from the next asset start.",
    info: "Permits a camera that is pushing to the relay to be attached as live picture and sound while an asset plays, instead of the slow-refresh snapshot; it lands when the next asset starts, never mid-asset. Needs Video sources on the stream to be on as well; with either switch off the worker never asks the relay whether the camera is there."
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
          {SWITCHES.map(({ key, label, hint, info }) => (
            <label key={key} title={hint}>
              <span className="label label-with-info">
                {label}
                <InfoTip text={info} />
              </span>
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
