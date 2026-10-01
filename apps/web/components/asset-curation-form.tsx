"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
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
        <span>Include in programming rotation<InfoTip text="Pools, schedule blocks and the automatic fallback may pick this asset on their own. Switched off, it stays in the library but nothing selects it automatically, Play next and Replay previous skip it, and the global fallback flag below is cleared as well; only Play now, Insert or a direct override still put it on air." /></span>
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
        <span>Use as global fallback candidate<InfoTip text="Puts this asset first in line, once it is ready, when the schedule has nothing playable or the current item fails to start; if several are marked, Fallback priority decides. Turning it on also includes it in programming and keeps its file out of the low-disk clean-up." /></span>
      </label>
      <label>
        <span className="label label-with-info">Fallback priority<InfoTip text="Orders the fallback candidates when several are ready: the lowest number plays first. Only matters when the channel has to fall back; 1 to 9999." /></span>
        <input
          min={1}
          onChange={(event) => setFallbackPriority(Number(event.target.value || 1))}
          step={1}
          type="number"
          value={fallbackPriority}
        />
      </label>
      <label>
        <span className="label label-with-info">Folder path<InfoTip text="Groups the asset under this folder in the library browser and makes it findable with the folder filter. Only the library view changes, not the stored file or what plays." /></span>
        <input
          onChange={(event) => setFolderPath(event.target.value)}
          placeholder="uploads/highlights"
          value={folderPath}
        />
      </label>
      <label>
        <span className="label label-with-info">Tags<InfoTip text="Comma-separated labels the library's tag filter and search match on, for finding and grouping assets; a label may contain spaces. They have no effect on air; duplicates are dropped and up to 24 are kept." /></span>
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
