"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
        <span className="label">Display name</span>
        <input onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <label>
        <span className="label">Connector type</span>
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
        <span className="label">{connector.urlLabel}</span>
        <input
          disabled={!connector.requiresUrl}
          onChange={(event) => setExternalUrl(event.target.value)}
          placeholder={connector.requiresUrl ? connector.placeholder : "No external URL needed"}
          value={connector.requiresUrl ? externalUrl : ""}
        />
      </label>
      <div className="subtle">{connector.notes}</div>
      <div className="toggle-row">
        <button className="button" disabled={isPending} type="submit">
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
