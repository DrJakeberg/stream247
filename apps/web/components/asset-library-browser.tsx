"use client";

import Link from "next/link";
import { useState } from "react";
import type { AssetRecord, SourceRecord } from "@/lib/server/state";

export function AssetLibraryBrowser(props: { assets: AssetRecord[]; sources: SourceRecord[] }) {
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState("all");
  const [status, setStatus] = useState("all");

  const filteredAssets = props.assets.filter((asset) => {
    if (sourceId !== "all" && asset.sourceId !== sourceId) {
      return false;
    }

    if (status !== "all" && asset.status !== status) {
      return false;
    }

    if (!query.trim()) {
      return true;
    }

    const haystack = [asset.title, asset.categoryName || "", asset.externalId || "", asset.path].join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

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
      </div>
      <div className="subtle">
        Showing {filteredAssets.length} of {props.assets.length} assets.
      </div>
      <div className="list">
        {filteredAssets.slice(0, 40).map((asset) => {
          const source = props.sources.find((entry) => entry.id === asset.sourceId);
          return (
            <div className="item" key={asset.id}>
              <strong className="truncate-title">{asset.title}</strong>
              <div className="subtle">
                {source?.name || asset.sourceId} · {asset.status} ·{" "}
                {asset.durationSeconds ? `${Math.round(asset.durationSeconds / 60)}m` : "natural duration unknown"}
              </div>
              <div className="subtle">
                {asset.categoryName || "No source category"}
                {asset.publishedAt ? ` · ${asset.publishedAt.slice(0, 10)}` : ""}
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
