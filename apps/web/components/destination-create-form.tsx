"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

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
        <span className="label label-with-info">Name<InfoTip text="Shown as this output's heading in the destination list, and on the dashboard whenever this output is the lead. When two outputs share a priority, the alphabetically earlier name becomes the lead." /></span>
        <input onChange={(event) => setName(event.target.value)} placeholder="YouTube Output" value={name} />
      </label>
      <div className="grid two">
        <label>
          <span className="label label-with-info">Provider<InfoTip text="Records which kind of service this output feeds. Delivery works the same either way: the channel pushes to the RTMP URL and stream key below and does not treat a Twitch output differently." /></span>
          <select onChange={(event) => setProvider(event.target.value as typeof provider)} value={provider}>
            <option value="custom-rtmp">Custom RTMP</option>
            <option value="twitch">Twitch</option>
          </select>
        </label>
        <label>
          <span className="label label-with-info">Role<InfoTip text="Primary outputs carry the channel whenever at least one of them is ready. Backup outputs stay idle and take over only while no primary output is ready." /></span>
          <select onChange={(event) => setRole(event.target.value as typeof role)} value={role}>
            <option value="primary">Primary</option>
            <option value="backup">Backup</option>
          </select>
        </label>
      </div>
      <div className="grid two">
        <label>
          <span className="label label-with-info">Priority<InfoTip text="Lower numbers go first. All ready outputs of the winning role stream at the same time, and the lowest number among them is the lead output." /></span>
          <input min={0} onChange={(event) => setPriority(event.target.value)} type="number" value={priority} />
        </label>
        <label>
          <span className="label label-with-info">RTMP URL<InfoTip text="The ingest address the encoder pushes to; the stream key is appended to it to form the full target. Until both this and the key are set, the output reads 'Not set up yet' and is never used." /></span>
          <input onChange={(event) => setRtmpUrl(event.target.value)} placeholder="rtmp://..." value={rtmpUrl} />
        </label>
      </div>
      <label>
        <span className="label label-with-info">Stream key<InfoTip text="Saved encrypted and never shown again; the list only tells you whether a key is present. An output without a key is never chosen for delivery, whatever its role or priority." /></span>
        <input
          autoComplete="new-password"
          onChange={(event) => setStreamKey(event.target.value)}
          placeholder="paste stream key"
          type="password"
          value={streamKey}
        />
      </label>
      <label>
        <span className="label label-with-info">Notes<InfoTip text="Free text for the operators: shown under this output in the control room and next to the live destination's status on the dashboard. It also travels with channel blueprints." /></span>
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
