"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ChannelBlueprintForm() {
  const [blueprintText, setBlueprintText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function exportBlueprint() {
    const response = await fetch("/api/blueprints");
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: "" }))) as { message?: string };
      throw new Error(payload.message || "Could not export channel blueprint.");
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get("content-disposition") || "";
    const match = contentDisposition.match(/filename=\"([^\"]+)\"/i);
    const fileName = match?.[1] || "stream247.channel-blueprint.json";
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  async function importBlueprint() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(blueprintText);
    } catch {
      throw new Error("Paste a valid blueprint JSON document before importing.");
    }

    const response = await fetch("/api/blueprints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blueprint: parsed })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      throw new Error(payload.message || "Could not import channel blueprint.");
    }

    setBlueprintText("");
    router.refresh();
    return payload.message || "Channel blueprint imported.";
  }

  return (
    <div className="stack-form">
      <div className="subtle">
        Channel Blueprints package Scene Studio, sources, pools, show profiles, schedule blocks, moderation, and
        destination routing metadata without exporting secrets, tokens, incidents, or media files.
      </div>
      <div className="toggle-row">
        <button
          className="button"
          disabled={isPending}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() =>
              void exportBlueprint()
                .then(() => setMessage("Downloaded the current channel blueprint."))
                .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Could not export channel blueprint."))
            );
          }}
          type="button"
        >
          {isPending ? "Working..." : "Export channel blueprint"}
        </button>
      </div>
      <label>
        <span className="label">Import blueprint JSON</span>
        <textarea
          className="textarea"
          onChange={(event) => setBlueprintText(event.target.value)}
          placeholder='Paste a `.channel-blueprint.json` document here to replace the current library/programming configuration.'
          rows={12}
          value={blueprintText}
        />
      </label>
      <label>
        <span className="label">Load blueprint file</span>
        <input
          accept=".json,application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            setBlueprintText(await file.text());
          }}
          type="file"
        />
      </label>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button
        className="button secondary"
        disabled={isPending || !blueprintText.trim()}
        onClick={() => {
          setError("");
          setMessage("");
          startTransition(() =>
            void importBlueprint()
              .then((nextMessage) => setMessage(nextMessage))
              .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Could not import channel blueprint."))
          );
        }}
        type="button"
      >
        {isPending ? "Importing..." : "Import blueprint"}
      </button>
    </div>
  );
}
