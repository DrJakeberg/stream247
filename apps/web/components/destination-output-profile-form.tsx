"use client";

import { DESTINATION_OUTPUT_PROFILES, type DestinationOutputProfileId } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { StreamDestinationRecord } from "@/lib/server/state";

export function DestinationOutputProfileForm(props: {
  destination: StreamDestinationRecord;
  effectiveLabel: string;
  streamProfileLabel: string;
}) {
  const [outputProfileId, setOutputProfileId] = useState<DestinationOutputProfileId>(props.destination.outputProfileId ?? "inherit");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function save() {
    const response = await fetch("/api/destinations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: props.destination.id,
        outputProfileId
      })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update the output profile.");
      return;
    }

    setMessage("Output profile updated.");
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");
        startTransition(() => void save());
      }}
    >
      <div className="stats-row">
        <span className="badge">{props.destination.role}</span>
        <span className="subtle">{props.destination.enabled ? "enabled" : "disabled"}</span>
        <span className="subtle">{props.destination.status}</span>
      </div>
      <label>
        <span className="label">Destination profile</span>
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
      <p className="subtle">
        Effective rendition {props.effectiveLabel}. Inherit follows the stream profile ({props.streamProfileLabel}).
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button secondary" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
