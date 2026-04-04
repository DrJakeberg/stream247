"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { StreamDestinationRecord } from "@/lib/server/state";

export function DestinationSettingsForm({ destination }: { destination: StreamDestinationRecord }) {
  const [name, setName] = useState(destination.name);
  const [rtmpUrl, setRtmpUrl] = useState(destination.rtmpUrl);
  const [notes, setNotes] = useState(destination.notes);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function save(nextEnabled: boolean, clearFailure = false) {
    const response = await fetch("/api/destinations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: destination.id,
        enabled: nextEnabled,
        name,
        rtmpUrl,
        notes,
        clearFailure
      })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update destination.");
      return;
    }
    setMessage(payload.message ?? "Destination updated.");
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");
        startTransition(() => void save(destination.enabled));
      }}
    >
      <div className="stats-row">
        <span className="badge">{destination.role}</span>
        <span className="subtle">Priority {destination.priority}</span>
        <span className="subtle">{destination.streamKeyPresent ? "stream key present" : "stream key missing"}</span>
      </div>
      {destination.lastFailureAt ? (
        <p className="danger">
          Recent failure at {destination.lastFailureAt}. {destination.lastError || "No detailed destination error captured yet."}
        </p>
      ) : null}
      <label>
        <span className="label">Name</span>
        <input onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <label>
        <span className="label">RTMP URL</span>
        <input onChange={(event) => setRtmpUrl(event.target.value)} placeholder="rtmp://..." value={rtmpUrl} />
      </label>
      <label>
        <span className="label">Notes</span>
        <input onChange={(event) => setNotes(event.target.value)} placeholder="Operator note" value={notes} />
      </label>
      <p className="subtle">
        {destination.role === "backup"
          ? "Backup output uses BACKUP_STREAM_OUTPUT_URL/KEY or BACKUP_TWITCH_RTMP_URL/TWITCH_STREAM_KEY."
          : "Primary output uses STREAM_OUTPUT_URL/KEY or TWITCH_RTMP_URL/TWITCH_STREAM_KEY."}
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <div className="toggle-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save destination"}
        </button>
        <button
          className="button secondary"
          disabled={isPending}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void save(!destination.enabled));
          }}
          type="button"
        >
          {destination.enabled ? "Disable" : "Enable"}
        </button>
        {destination.status === "error" ? (
          <button
            className="button secondary"
            disabled={isPending}
            onClick={() => {
              setError("");
              setMessage("");
              startTransition(() => void save(destination.enabled, true));
            }}
            type="button"
          >
            Clear failure hold
          </button>
        ) : null}
      </div>
    </form>
  );
}
