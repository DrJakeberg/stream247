"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function DestinationCreateForm() {
  const [provider, setProvider] = useState<"twitch" | "custom-rtmp">("custom-rtmp");
  const [role, setRole] = useState<"primary" | "backup">("primary");
  const [priority, setPriority] = useState("1");
  const [name, setName] = useState("");
  const [rtmpUrl, setRtmpUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function createDestination() {
    const response = await fetch("/api/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        role,
        priority: Number(priority) || 0,
        name,
        rtmpUrl,
        streamKey,
        notes
      })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not create destination.");
      return;
    }

    setName("");
    setRtmpUrl("");
    setStreamKey("");
    setNotes("");
    setMessage("Destination created.");
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");
        startTransition(() => void createDestination());
      }}
    >
      <div className="stats-row">
        <span className="badge">Add output</span>
        <span className="subtle">Create another primary or backup RTMP target.</span>
      </div>
      <label>
        <span className="label">Name</span>
        <input onChange={(event) => setName(event.target.value)} placeholder="YouTube Output" value={name} />
      </label>
      <div className="grid two">
        <label>
          <span className="label">Provider</span>
          <select onChange={(event) => setProvider(event.target.value as typeof provider)} value={provider}>
            <option value="custom-rtmp">Custom RTMP</option>
            <option value="twitch">Twitch</option>
          </select>
        </label>
        <label>
          <span className="label">Role</span>
          <select onChange={(event) => setRole(event.target.value as typeof role)} value={role}>
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
        <span className="label">Stream key</span>
        <input
          autoComplete="new-password"
          onChange={(event) => setStreamKey(event.target.value)}
          placeholder="paste stream key"
          type="password"
          value={streamKey}
        />
      </label>
      <label>
        <span className="label">Notes</span>
        <input onChange={(event) => setNotes(event.target.value)} placeholder="Where this output is used" value={notes} />
      </label>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Creating..." : "Add destination"}
      </button>
    </form>
  );
}
