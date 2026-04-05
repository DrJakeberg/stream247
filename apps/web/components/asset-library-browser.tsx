"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { AssetRecord, SourceRecord } from "@/lib/server/state";

export function AssetLibraryBrowser(props: { assets: AssetRecord[]; sources: SourceRecord[] }) {
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState("all");
  const [status, setStatus] = useState("all");
  const [programmingState, setProgrammingState] = useState("all");
  const [folderFilter, setFolderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const filteredAssets = props.assets.filter((asset) => {
    if (sourceId !== "all" && asset.sourceId !== sourceId) {
      return false;
    }

    if (status !== "all" && asset.status !== status) {
      return false;
    }

    if (programmingState === "included" && !asset.includeInProgramming) {
      return false;
    }

    if (programmingState === "excluded" && asset.includeInProgramming) {
      return false;
    }

    if (programmingState === "fallback" && !asset.isGlobalFallback) {
      return false;
    }

    if (folderFilter.trim() && !(asset.folderPath || "").toLowerCase().includes(folderFilter.trim().toLowerCase())) {
      return false;
    }

    if (
      tagFilter.trim() &&
      !(asset.tags || []).some((tag) => tag.toLowerCase().includes(tagFilter.trim().toLowerCase()))
    ) {
      return false;
    }

    if (!query.trim()) {
      return true;
    }

    const haystack = [asset.title, asset.categoryName || "", asset.externalId || "", asset.path, asset.folderPath || "", ...(asset.tags || [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  const selectedAssets = useMemo(
    () => props.assets.filter((asset) => selectedIds.includes(asset.id)),
    [props.assets, selectedIds]
  );

  async function applyBulkAction(
    action:
      | "include"
      | "exclude"
      | "mark_global_fallback"
      | "clear_global_fallback"
      | "set_folder"
      | "clear_folder"
      | "append_tags"
      | "replace_tags"
      | "clear_tags"
  ) {
    const response = await fetch("/api/assets/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        assetIds: selectedIds,
        folderPath: folderDraft,
        tags: tagsDraft
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not apply bulk asset action.");
      return;
    }

    setMessage(payload.message ?? "Bulk asset action applied.");
    setSelectedIds([]);
    router.refresh();
  }

  return (
    <div className="stack-form">
      <div className="form-grid">
        <label>
          <span className="label">Search assets</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Title, category, external id..." value={query} />
        </label>
        <label>
          <span className="label">Source</span>
          <select onChange={(event) => setSourceId(event.target.value)} value={sourceId}>
            <option value="all">All sources</option>
            {props.sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Asset status</span>
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="pending">Pending</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label>
          <span className="label">Programming</span>
          <select onChange={(event) => setProgrammingState(event.target.value)} value={programmingState}>
            <option value="all">All assets</option>
            <option value="included">Included in programming</option>
            <option value="excluded">Excluded from programming</option>
            <option value="fallback">Global fallback only</option>
          </select>
        </label>
        <label>
          <span className="label">Folder</span>
          <input onChange={(event) => setFolderFilter(event.target.value)} placeholder="uploads/highlights" value={folderFilter} />
        </label>
        <label>
          <span className="label">Tag</span>
          <input onChange={(event) => setTagFilter(event.target.value)} placeholder="retro or sponsor-safe" value={tagFilter} />
        </label>
      </div>
      <div className="subtle">
        Showing {filteredAssets.length} of {props.assets.length} assets.
      </div>
      <div className="subtle">
        {selectedAssets.length > 0
          ? `Selected ${selectedAssets.length} asset(s): ${selectedAssets.map((asset) => asset.title).join(", ")}`
          : "No assets selected yet."}
      </div>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <div className="form-grid">
        <label>
          <span className="label">Bulk folder path</span>
          <input onChange={(event) => setFolderDraft(event.target.value)} placeholder="uploads/season-1" value={folderDraft} />
        </label>
        <label>
          <span className="label">Bulk tags</span>
          <input onChange={(event) => setTagsDraft(event.target.value)} placeholder="retro, marathon, sponsor-safe" value={tagsDraft} />
        </label>
      </div>
      <div className="toggle-row">
        <button
          className="button"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void applyBulkAction("include"));
          }}
          type="button"
        >
          {isPending ? "Applying..." : "Include selected"}
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void applyBulkAction("exclude"));
          }}
          type="button"
        >
          Exclude selected
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void applyBulkAction("mark_global_fallback"));
          }}
          type="button"
        >
          Mark fallback
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void applyBulkAction("clear_global_fallback"));
          }}
          type="button"
        >
          Clear fallback
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void applyBulkAction("set_folder"));
          }}
          type="button"
        >
          Set folder
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void applyBulkAction("clear_folder"));
          }}
          type="button"
        >
          Clear folder
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void applyBulkAction("append_tags"));
          }}
          type="button"
        >
          Add tags
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void applyBulkAction("replace_tags"));
          }}
          type="button"
        >
          Replace tags
        </button>
        <button
          className="button secondary"
          disabled={isPending || selectedIds.length === 0}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(() => void applyBulkAction("clear_tags"));
          }}
          type="button"
        >
          Clear tags
        </button>
      </div>
      <div className="list">
        {filteredAssets.slice(0, 40).map((asset) => {
          const source = props.sources.find((entry) => entry.id === asset.sourceId);
          const selected = selectedIds.includes(asset.id);
          return (
            <div className="item" key={asset.id}>
              <label className={`chip-toggle${selected ? " chip-toggle-active" : ""}`} style={{ marginBottom: 8 }}>
                <input
                  checked={selected}
                  onChange={(event) =>
                    setSelectedIds((current) =>
                      event.target.checked
                        ? [...current, asset.id].sort((left, right) => left.localeCompare(right))
                        : current.filter((id) => id !== asset.id)
                    )
                  }
                  type="checkbox"
                />
                <span>Select asset</span>
              </label>
              <strong className="truncate-title">{asset.title}</strong>
              <div className="subtle">
                {source?.name || asset.sourceId} · {asset.status} ·{" "}
                {asset.durationSeconds ? `${Math.round(asset.durationSeconds / 60)}m` : "natural duration unknown"}
              </div>
              <div className="subtle">
                {asset.categoryName || "No source category"}
                {asset.publishedAt ? ` · ${asset.publishedAt.slice(0, 10)}` : ""}
              </div>
              <div className="subtle">
                Folder: {asset.folderPath || "root"} · Tags: {asset.tags && asset.tags.length > 0 ? asset.tags.join(", ") : "none"}
              </div>
              <div className="subtle">
                {asset.includeInProgramming ? "Included in programming" : "Excluded from programming"} ·{" "}
                {asset.isGlobalFallback ? `Global fallback (priority ${asset.fallbackPriority})` : "No global fallback flag"}
              </div>
              <div className="subtle asset-path">{asset.path}</div>
              <div style={{ marginTop: 8 }}>
                <Link className="subtle-link" href={`/assets/${asset.id}`}>
                  Open asset detail
                </Link>
              </div>
            </div>
          );
        })}
        {filteredAssets.length === 0 ? (
          <div className="item">
            <strong>No assets match the current filters</strong>
            <div className="subtle">Try a different source, status, or search query.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
