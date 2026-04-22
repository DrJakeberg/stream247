"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { getSourceConnectorDefinition, sourceConnectorDefinitions, type SourceConnectorKind } from "@/lib/source-connectors";

export function SourceCreateForm() {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [connectorKind, setConnectorKind] = useState<SourceConnectorKind>("twitch-channel");
  const [name, setName] = useState("Twitch Archive");
  const [externalUrl, setExternalUrl] = useState("");
  const router = useRouter();
  const { pushToast } = useToast();

  const connector = getSourceConnectorDefinition(connectorKind);

  function chooseConnector(nextKind: SourceConnectorKind) {
    const nextConnector = getSourceConnectorDefinition(nextKind);
    setConnectorKind(nextKind);
    setError("");
    setName((current) => (current.trim() === "" || current === connector.suggestedName ? nextConnector.suggestedName : current));
    setExternalUrl((current) => {
      if (!nextConnector.requiresUrl) {
        return "";
      }

      return current;
    });
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        startTransition(async () => {
          const response = await fetch("/api/sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              connectorKind,
              externalUrl: connector.requiresUrl ? externalUrl : ""
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            const nextError = payload.message ?? "Could not save source.";
            setError(nextError);
            pushToast({ title: "Source could not be saved.", description: nextError, tone: "error" });
            return;
          }

          pushToast({ title: payload.message ?? "Source saved.", tone: "success" });
          if (connector.requiresUrl) {
            setExternalUrl("");
          }
          setName(getSourceConnectorDefinition(connectorKind).suggestedName);
          router.refresh();
        });
      }}
    >
      <div className="stack-form">
        <div>
          <span className="label">Choose a source type</span>
          <div className="preset-grid" style={{ marginTop: 12 }}>
            {sourceConnectorDefinitions.map((entry) => (
              <button
                className={`preset-card${entry.id === connectorKind ? " preset-card-active" : ""}`}
                key={entry.id}
                onClick={() => chooseConnector(entry.id)}
                type="button"
              >
                <strong>{entry.label}</strong>
                <div className="subtle">{entry.description}</div>
                <div className="subtle" style={{ marginTop: 8 }}>
                  {entry.helper}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <label>
        <span className="label">Display name</span>
        <input onChange={(event) => setName(event.target.value)} placeholder={connector.suggestedName} required value={name} />
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
        <div className="subtle">{connector.notes}</div>
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

      {connector.requiresUrl ? (
        <p className="subtle">
          Use the canonical source URL here. Stream247 will keep the original title, natural duration, and upstream metadata where available.
        </p>
      ) : (
        <p className="subtle">This connector scans the shared local media path automatically. No external URL is required.</p>
      )}

      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Add source"}
      </button>
    </form>
  );
}
