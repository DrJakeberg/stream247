"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { getSourceConnectorDefinition, sourceConnectorDefinitions, type SourceConnectorKind } from "@/lib/source-connectors";
import type { SourceRecord } from "@/lib/server/state";

export function SourceActionsForm(props: { source: SourceRecord }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(props.source.name);
  const [connectorKind, setConnectorKind] = useState<SourceConnectorKind>(props.source.connectorKind);
  const [externalUrl, setExternalUrl] = useState(props.source.externalUrl || "");
  const router = useRouter();

  const connector = getSourceConnectorDefinition(connectorKind);

  function chooseConnector(nextKind: SourceConnectorKind) {
    const nextConnector = getSourceConnectorDefinition(nextKind);
    setConnectorKind(nextKind);
    setError("");
    setMessage("");
    if (!nextConnector.requiresUrl) {
      setExternalUrl("");
    }
  }

  async function updateSource(enabled: boolean) {
    const response = await fetch("/api/sources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: props.source.id,
        name,
        connectorKind,
        externalUrl: connector.requiresUrl ? externalUrl : "",
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
        startTransition(() => void updateSource(props.source.enabled ?? true));
      }}
    >
      <label>
        <span className="label label-with-info">Display name<InfoTip text="Names the source in the queue caption and in the asset library's by-source view. For direct, YouTube and Twitch sources it also sets the folder their assets are filed under after the next sync; local-library assets keep their on-disk folder. On air, the source label shows the running schedule block's pool name, and this name only when no block is scheduled. Renaming keeps the source and its assets." /></span>
        <input onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <label>
        <span className="label label-with-info">Connector type<InfoTip text="Decides where the worker fetches this source's videos from on each sync: the local media folder, one direct file URL, a YouTube playlist or channel, a single Twitch VOD, or a Twitch channel's archive. It also sets which shape the address below must have; the example and notes underneath change with it." /></span>
        <select onChange={(event) => chooseConnector(event.target.value as SourceConnectorKind)} value={connectorKind}>
          {sourceConnectorDefinitions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <div className="item">
        <strong>{connector.shortLabel}</strong>
        <div className="subtle">{connector.helper}</div>
        <div className="subtle" style={{ marginTop: 4 }}>
          Example: {connector.example}
        </div>
      </div>
      <label>
        <span className="label label-with-info">{connector.urlLabel}<InfoTip text="Where the worker looks for this source's videos on every sync. YouTube and Twitch addresses are checked for the expected shape before saving, a direct media URL only has to be present, and the local media library needs no address at all." /></span>
        <input
          disabled={!connector.requiresUrl}
          onChange={(event) => setExternalUrl(event.target.value)}
          placeholder={connector.requiresUrl ? connector.placeholder : "No external URL needed"}
          value={connector.requiresUrl ? externalUrl : ""}
        />
      </label>
      <div className="subtle">{connector.notes}</div>
      <div className="toggle-row">
        {/* One of these per source, so it cannot be the page's main action. Adding a source is. */}
        <button className="button button-secondary" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save"}
        </button>
        <button
          className="button secondary"
          disabled={isPending}
          onClick={() => {
            startTransition(() => void updateSource(!(props.source.enabled ?? true)));
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
