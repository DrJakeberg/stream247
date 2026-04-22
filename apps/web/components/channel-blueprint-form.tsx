"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { BlueprintImportSectionState } from "@/lib/server/channel-blueprints";

const DEFAULT_SECTIONS: BlueprintImportSectionState = {
  library: true,
  programming: true,
  sceneStudio: true,
  operations: true
};

export function ChannelBlueprintForm() {
  const [blueprintText, setBlueprintText] = useState("");
  const [sections, setSections] = useState<BlueprintImportSectionState>(DEFAULT_SECTIONS);
  const [warnings, setWarnings] = useState<string[]>([]);
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

    if (!Object.values(sections).some(Boolean)) {
      throw new Error("Enable at least one import section before importing a blueprint.");
    }

    const response = await fetch("/api/blueprints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blueprint: parsed,
        options: { sections }
      })
    });
    const payload = (await response.json()) as { message?: string; warnings?: string[] };
    if (!response.ok) {
      throw new Error(payload.message || "Could not import channel blueprint.");
    }

    setBlueprintText("");
    setWarnings(payload.warnings ?? []);
    router.refresh();
    return payload.message || "Channel blueprint imported.";
  }

  return (
    <div className="stack-form">
      <div className="subtle">
        Channel Blueprints package Scene, sources, curated sets, program data, moderation, and destination
        routing metadata without exporting secrets, tokens, incidents, or media files.
      </div>
      <div className="subtle">
        Media binaries never travel with the blueprint. Insert assets, audio beds, cuepoint assets, and curated-set
        memberships only remap when matching media is already present locally in the target workspace.
      </div>
      <div className="toggle-row">
        <button
          className="button"
          disabled={isPending}
          onClick={() => {
            setError("");
            setMessage("");
            setWarnings([]);
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
      <div className="panel panel-compact">
        <div className="stack-form">
          <div>
            <strong>Import sections</strong>
            <div className="subtle">
              Enabled sections replace the matching part of the current workspace. Leave a section disabled to keep the
              existing local state untouched.
            </div>
          </div>
          <div className="chip-grid">
            <label className={`chip-toggle${sections.library ? " chip-toggle-active" : ""}`}>
              <input
                checked={sections.library}
                onChange={(event) => setSections((current) => ({ ...current, library: event.target.checked }))}
                type="checkbox"
              />
              <span>Library sources and curated sets</span>
            </label>
            <label className={`chip-toggle${sections.programming ? " chip-toggle-active" : ""}`}>
              <input
                checked={sections.programming}
                onChange={(event) => setSections((current) => ({ ...current, programming: event.target.checked }))}
                type="checkbox"
              />
              <span>Program pools, shows, and schedule</span>
            </label>
            <label className={`chip-toggle${sections.sceneStudio ? " chip-toggle-active" : ""}`}>
              <input
                checked={sections.sceneStudio}
                onChange={(event) => setSections((current) => ({ ...current, sceneStudio: event.target.checked }))}
                type="checkbox"
              />
              <span>Scene live, draft, and presets</span>
            </label>
            <label className={`chip-toggle${sections.operations ? " chip-toggle-active" : ""}`}>
              <input
                checked={sections.operations}
                onChange={(event) => setSections((current) => ({ ...current, operations: event.target.checked }))}
                type="checkbox"
              />
              <span>Moderation and destination routing</span>
            </label>
          </div>
        </div>
      </div>
      <label>
        <span className="label">Import blueprint JSON</span>
        <textarea
          className="textarea"
          onChange={(event) => setBlueprintText(event.target.value)}
          placeholder='Paste a `.channel-blueprint.json` document here to replace the enabled sections of the current workspace.'
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
      {warnings.length > 0 ? (
        <div className="item">
          <strong>Import warnings</strong>
          <div className="stack-form" style={{ marginTop: 10 }}>
            {warnings.map((warning) => (
              <div className="warning" key={warning}>
                {warning}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <button
        className="button secondary"
        disabled={isPending || !blueprintText.trim() || !Object.values(sections).some(Boolean)}
        onClick={() => {
          setError("");
          setMessage("");
          setWarnings([]);
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
