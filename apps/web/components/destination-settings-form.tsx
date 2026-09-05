"use client";

import { DESTINATION_OUTPUT_PROFILES, type DestinationOutputProfileId } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { StreamDestinationRecord } from "@/lib/server/state";
import { DESTINATION_ROLE_LABELS, describeStreamKey } from "@/lib/destination-wording";
import { InfoTip } from "@/components/ui/InfoTip";

function isProtectedDestination(destinationId: string): boolean {
  return destinationId === "destination-primary" || destinationId === "destination-backup";
}

export function DestinationSettingsForm({ destination }: { destination: StreamDestinationRecord }) {
  const [provider, setProvider] = useState(destination.provider);
  const [role, setRole] = useState(destination.role);
  const [priority, setPriority] = useState(String(destination.priority));
  const [outputProfileId, setOutputProfileId] = useState<DestinationOutputProfileId>(destination.outputProfileId ?? "inherit");
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
        outputProfileId,
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
        <span className="badge">{DESTINATION_ROLE_LABELS[destination.role]}</span>
        <span className="subtle">Priority {destination.priority}</span>
        <span className="subtle">Quality {destination.outputProfileId ?? "same as the channel"}</span>
        <span className="subtle">{describeStreamKey(destination.streamKeyPresent, destination.streamKeySource)}</span>
      </div>
      {destination.lastFailureAt ? (
        <p className="danger">
          Recent failure at {destination.lastFailureAt}. {destination.lastError || "No detailed destination error captured yet."}
        </p>
      ) : null}
      <label>
        <span className="label label-with-info">Name<InfoTip text="Shown wherever this destination is listed: the dashboard, the output page and the control room. Among destinations tied on priority, the one whose name sorts first is shown as the active destination; leaving the field empty keeps the old name." /></span>
        <input onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <div className="grid two">
        <label>
          <span className="label label-with-info">Provider<InfoTip text="Kept as a note of what kind of endpoint this is; it does not change how the channel sends. Twitch and any other RTMP server both receive the same stream at the URL below." /></span>
          <select onChange={(event) => setProvider(event.target.value as typeof provider)} value={provider}>
            <option value="twitch">Twitch</option>
            <option value="custom-rtmp">Custom RTMP</option>
          </select>
        </label>
        <label>
          <span className="label label-with-info">Role<InfoTip text="Every Ready primary goes on air together; backups take over only when no primary is Ready and at least one backup is. When nothing is Ready the enabled primaries, or failing that the backups, are tried anyway; the built-in primary and backup keep their roles." /></span>
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
          <span className="label label-with-info">Priority<InfoTip text="Orders destinations of the same role, lowest number first; among the Ready ones the lowest leads the group and is shown as the active destination. Whole numbers from 0 up." /></span>
          <input min={0} onChange={(event) => setPriority(event.target.value)} type="number" value={priority} />
        </label>
        <label>
          <span className="label label-with-info">Output profile<InfoTip text="Picture size and frame rate sent to this destination. Use stream profile follows the channel's own output settings; each distinct size and frame rate among the active destinations costs one encode, so destinations that land on the same size share it whether they chose it or inherited it." /></span>
          <select
            onChange={(event) => setOutputProfileId(event.target.value as DestinationOutputProfileId)}
            value={outputProfileId}
          >
            {DESTINATION_OUTPUT_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid two">
        <label>
          <span className="label label-with-info">RTMP URL<InfoTip text="Address the channel pushes the stream to, with the stream key appended. Without it the destination shows Not set up yet (the built-in primary and backup fall back to the server configuration), and encoder errors that mention this address put this destination on a failure hold." /></span>
          <input onChange={(event) => setRtmpUrl(event.target.value)} placeholder="rtmp://..." value={rtmpUrl} />
        </label>
      </div>
      <label>
        <span className="label label-with-info">Managed stream key<InfoTip text="Stored encrypted with the destination and used ahead of any key from the server configuration. Leave it blank to keep the current key; a new key makes the destination ready as soon as it is enabled and has an RTMP URL." /></span>
        <input
          autoComplete="new-password"
          onChange={(event) => setStreamKey(event.target.value)}
          placeholder={destination.streamKeyPresent ? "Leave blank to keep current key" : "paste stream key"}
          type="password"
          value={streamKey}
        />
      </label>
      <label>
        <span className="label label-with-info">Notes<InfoTip text="Shown under this destination in the control room and, while it is live, on the dashboard. The runtime replaces it with its own status line on every sync, so anything you type here lasts only until then." /></span>
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
