"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { StreamDestinationRecord } from "@/lib/server/state";

function isProtectedDestination(destinationId: string): boolean {
  return destinationId === "destination-primary" || destinationId === "destination-backup";
}

export function DestinationSettingsForm({ destination }: { destination: StreamDestinationRecord }) {
  const [provider, setProvider] = useState(destination.provider);
  const [role, setRole] = useState(destination.role);
  const [priority, setPriority] = useState(String(destination.priority));
  const [name, setName] = useState(destination.name);
  const [rtmpUrl, setRtmpUrl] = useState(destination.rtmpUrl);
  const [notes, setNotes] = useState(destination.notes);
  const [streamKey, setStreamKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const protectedDestination = isProtectedDestination(destination.id);

  async function save(nextEnabled: boolean, options?: { clearFailure?: boolean; clearManagedStreamKey?: boolean }) {
    const response = await fetch("/api/destinations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: destination.id,
        provider,
        role,
        priority: Number(priority) || 0,
        enabled: nextEnabled,
        name,
        rtmpUrl,
        notes,
        streamKey: streamKey.trim(),
        clearManagedStreamKey: options?.clearManagedStreamKey ?? false,
        clearFailure: options?.clearFailure ?? false
      })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update destination.");
      return;
    }
    setStreamKey("");
    setMessage(payload.message ?? "Destination updated.");
    router.refresh();
  }

  async function remove() {
    const response = await fetch("/api/destinations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: destination.id })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not delete destination.");
      return;
    }
    setMessage("Destination deleted.");
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
        <span className="subtle">key source {destination.streamKeySource || "missing"}</span>
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
      <div className="grid two">
        <label>
          <span className="label">Provider</span>
          <select onChange={(event) => setProvider(event.target.value as typeof provider)} value={provider}>
            <option value="twitch">Twitch</option>
            <option value="custom-rtmp">Custom RTMP</option>
          </select>
        </label>
        <label>
          <span className="label">Role</span>
          <select
            disabled={protectedDestination}
            onChange={(event) => setRole(event.target.value as typeof role)}
            value={role}
          >
            <option value="primary">Primary</option>
            <option value="backup">Backup</option>
          </select>
        </label>
      </div>
      <div className="grid two">
        <label>
          <span className="label">Priority</span>
          <input min={0} onChange={(event) => setPriority(event.target.value)} type="number" value={priority} />
        </label>
        <label>
          <span className="label">RTMP URL</span>
          <input onChange={(event) => setRtmpUrl(event.target.value)} placeholder="rtmp://..." value={rtmpUrl} />
        </label>
      </div>
      <label>
        <span className="label">Managed stream key</span>
        <input
          autoComplete="new-password"
          onChange={(event) => setStreamKey(event.target.value)}
          placeholder={destination.streamKeyPresent ? "Leave blank to keep current key" : "paste stream key"}
          type="password"
          value={streamKey}
        />
      </label>
      <label>
        <span className="label">Notes</span>
        <input onChange={(event) => setNotes(event.target.value)} placeholder="Operator note" value={notes} />
      </label>
      <p className="subtle">
        {destination.id === "destination-backup"
          ? "The built-in backup destination can use backup env vars or its own managed key."
          : destination.id === "destination-primary"
            ? "The built-in primary destination can use primary env vars or its own managed key."
            : "Additional outputs use their own managed stream keys and join the active multi-output group when healthy."}
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
        <button
          className="button secondary"
          disabled={isPending || destination.streamKeySource !== "managed"}
          onClick={() => {
            setError("");
            setMessage("");
            setStreamKey("");
            startTransition(() => void save(destination.enabled, { clearManagedStreamKey: true }));
          }}
          type="button"
        >
          Clear managed key
        </button>
        {destination.status === "error" ? (
          <button
            className="button secondary"
            disabled={isPending}
            onClick={() => {
              setError("");
              setMessage("");
              startTransition(() => void save(destination.enabled, { clearFailure: true }));
            }}
            type="button"
          >
            Clear failure hold
          </button>
        ) : null}
        {!protectedDestination ? (
          <button
            className="button secondary"
            disabled={isPending}
            onClick={() => {
              if (!window.confirm(`Delete destination ${destination.name}?`)) {
                return;
              }
              setError("");
              setMessage("");
              startTransition(() => void remove());
            }}
            type="button"
          >
            Delete
          </button>
        ) : null}
      </div>
    </form>
  );
}
