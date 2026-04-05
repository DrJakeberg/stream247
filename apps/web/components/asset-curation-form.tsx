"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AssetRecord } from "@/lib/server/state";

export function AssetCurationForm({ asset }: { asset: AssetRecord }) {
  const [includeInProgramming, setIncludeInProgramming] = useState(asset.includeInProgramming);
  const [isGlobalFallback, setIsGlobalFallback] = useState(asset.isGlobalFallback);
  const [fallbackPriority, setFallbackPriority] = useState(asset.fallbackPriority);
  const [folderPath, setFolderPath] = useState(asset.folderPath || "");
  const [tagsText, setTagsText] = useState((asset.tags || []).join(", "));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function save() {
    const response = await fetch("/api/assets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: asset.id,
        includeInProgramming,
        isGlobalFallback,
        fallbackPriority,
        folderPath,
        tags: tagsText
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update asset curation.");
      return;
    }

    setMessage(payload.message ?? "Asset updated.");
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
      <label className={`chip-toggle${includeInProgramming ? " chip-toggle-active" : ""}`}>
        <input
          checked={includeInProgramming}
          onChange={(event) => {
            const checked = event.target.checked;
            setIncludeInProgramming(checked);
            if (!checked) {
              setIsGlobalFallback(false);
            }
          }}
          type="checkbox"
        />
        <span>Include in programming rotation</span>
      </label>
      <label className={`chip-toggle${isGlobalFallback ? " chip-toggle-active" : ""}`}>
        <input
          checked={isGlobalFallback}
          onChange={(event) => {
            const checked = event.target.checked;
            setIsGlobalFallback(checked);
            if (checked) {
              setIncludeInProgramming(true);
            }
          }}
          type="checkbox"
        />
        <span>Use as global fallback candidate</span>
      </label>
      <label>
        <span className="label">Fallback priority</span>
        <input
          min={1}
          onChange={(event) => setFallbackPriority(Number(event.target.value || 1))}
          step={1}
          type="number"
          value={fallbackPriority}
        />
      </label>
      <label>
        <span className="label">Folder path</span>
        <input
          onChange={(event) => setFolderPath(event.target.value)}
          placeholder="uploads/highlights"
          value={folderPath}
        />
      </label>
      <label>
        <span className="label">Tags</span>
        <input
          onChange={(event) => setTagsText(event.target.value)}
          placeholder="retro, marathon, sponsor-safe"
          value={tagsText}
        />
      </label>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save asset curation"}
      </button>
    </form>
  );
}
