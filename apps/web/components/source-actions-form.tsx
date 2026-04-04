"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SourceRecord } from "@/lib/server/state";

export function SourceActionsForm(props: { source: SourceRecord }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function updateSource(formData: FormData, enabled: boolean) {
    const response = await fetch("/api/sources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: props.source.id,
        name: String(formData.get("name") || props.source.name),
        connectorKind: String(formData.get("connectorKind") || props.source.connectorKind),
        externalUrl: String(formData.get("externalUrl") || props.source.externalUrl || ""),
        enabled
      })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update source.");
      return;
    }
    setMessage(payload.message ?? "Source updated.");
    router.refresh();
  }

  async function deleteSource() {
    const response = await fetch("/api/sources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: props.source.id })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not delete source.");
      return;
    }
    setMessage(payload.message ?? "Source deleted.");
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");
        const formData = new FormData(event.currentTarget);
        startTransition(() => void updateSource(formData, props.source.enabled ?? true));
      }}
    >
      <label>
        <span className="label">Display name</span>
        <input defaultValue={props.source.name} name="name" />
      </label>
      <label>
        <span className="label">Connector type</span>
        <select defaultValue={props.source.connectorKind} name="connectorKind">
          <option value="local-library">Local media library</option>
          <option value="direct-media">Direct media URL</option>
          <option value="youtube-playlist">YouTube playlist</option>
          <option value="youtube-channel">YouTube channel</option>
          <option value="twitch-vod">Twitch VOD</option>
          <option value="twitch-channel">Twitch channel</option>
        </select>
      </label>
      <label>
        <span className="label">External URL</span>
        <input defaultValue={props.source.externalUrl || ""} name="externalUrl" placeholder="https://..." />
      </label>
      <div className="toggle-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save"}
        </button>
        <button
          className="button secondary"
          disabled={isPending}
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (!form) {
              return;
            }

            const formData = new FormData(form);
            startTransition(() => void updateSource(formData, !(props.source.enabled ?? true)));
          }}
          type="button"
        >
          {props.source.enabled ?? true ? "Disable" : "Enable"}
        </button>
        <button
          className="button secondary"
          disabled={isPending}
          onClick={() => {
            if (
              window.confirm(
                `Delete source ${props.source.name}? Its ingested assets will be removed. Sources that are still used by pools or schedule blocks can no longer be deleted until those references are removed.`
              )
            ) {
              startTransition(() => void deleteSource());
            }
          }}
          type="button"
        >
          Delete
        </button>
      </div>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
    </form>
  );
}
