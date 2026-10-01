"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
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
          <span className="label label-with-info">
            Choose a source type
            <InfoTip text="Which kind of place the worker imports from. YouTube and Twitch links are re-checked for the expected link shape before every sync, a direct URL must be an http(s) link ending in a media file such as .mp4, and the local library reads this server's shared media folder with no address at all." />
          </span>
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
        <span className="label label-with-info">
          Display name
          <InfoTip text="Shown on air under the current title when Show source label is on in Overlay settings, and used as this source's Library folder in Assets. For a direct media URL it also becomes the title of the single item it produces." />
        </span>
        <input onChange={(event) => setName(event.target.value)} placeholder={connector.suggestedName} required value={name} />
      </label>

      <label>
        <span className="label label-with-info">
          Connector type
          <InfoTip text="The same choice as the cards above, as a list. Picking another type swaps in its suggested name unless you have typed your own, and clears the address when the new type needs none." />
        </span>
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
        <span className="label label-with-info">
          {connector.urlLabel}
          <InfoTip
            text={
              connector.requiresUrl
                ? "Where the worker imports from; it must fit the chosen type — twitch.tv/<channel> for a Twitch archive, twitch.tv/videos/<id> for a VOD, a YouTube playlist link with a list parameter or a channel/handle page, or an http(s) link to a media file for a direct URL. It is re-checked before every sync: an address that no longer fits skips that sync, and items already imported stay."
                : "Nothing to enter: the local library reads the shared media folder on this server, so this source has no address."
            }
          />
        </span>
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
