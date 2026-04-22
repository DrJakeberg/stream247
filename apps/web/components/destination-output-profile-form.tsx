"use client";

import { DESTINATION_OUTPUT_PROFILES, type DestinationOutputProfileId } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { useToast } from "@/components/ui/Toast";
import { resolveDestinationStatusChip } from "@/lib/destination-status";
import type { StreamDestinationRecord } from "@/lib/server/state";

export function DestinationOutputProfileForm(props: {
  destination: StreamDestinationRecord;
  effectiveLabel: string;
  streamProfileLabel: string;
}) {
  const [outputProfileId, setOutputProfileId] = useState<DestinationOutputProfileId>(props.destination.outputProfileId ?? "inherit");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { pushToast } = useToast();
  const statusChip = resolveDestinationStatusChip(props.destination);

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
      const nextError = payload.message ?? "Could not update the output profile.";
      setError(nextError);
      pushToast({
        title: "Could not save the destination profile",
        description: nextError,
        tone: "error"
      });
      return;
    }

    pushToast({
      title: "Destination profile saved",
      description: "Output profile updated.",
      tone: "success"
    });
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(() => void save());
      }}
    >
      <div className="stats-row">
        <span className="badge">{props.destination.role}</span>
        <span className="subtle">{props.destination.enabled ? "enabled" : "disabled"}</span>
        <StatusChip label={statusChip.label} status={statusChip.status} />
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
      <button className="button secondary" disabled={isPending} title="Save the current destination override." type="submit">
        {isPending ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
