"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { AssetCollectionRecord, AssetRecord, SourceRecord } from "@/lib/server/state";

type GroupByMode = "none" | "source" | "folder" | "tag" | "curated-set" | "status";
type BulkAction =
  | "include"
  | "exclude"
  | "mark_global_fallback"
  | "clear_global_fallback"
  | "set_folder"
  | "clear_folder"
  | "append_tags"
  | "replace_tags"
  | "clear_tags";

type AssetGroup = {
  key: string;
  label: string;
  assets: AssetRecord[];
};

function formatDuration(asset: AssetRecord): string {
  return asset.durationSeconds ? `${Math.max(1, Math.round(asset.durationSeconds / 60))}m` : "Natural duration";
}

function buildGroups(args: {
  assets: AssetRecord[];
  collections: AssetCollectionRecord[];
  groupBy: GroupByMode;
  sourceById: Map<string, string>;
}): AssetGroup[] {
  if (args.groupBy === "none") {
    return [
      {
        key: "all",
        label: "Filtered assets",
        assets: args.assets
      }
    ];
  }

  const groups = new Map<string, AssetGroup>();
  const ensureGroup = (key: string, label: string) => {
    if (!groups.has(key)) {
      groups.set(key, { key, label, assets: [] });
    }
    return groups.get(key)!;
  };

  const collectionMemberships = new Map<string, AssetCollectionRecord[]>();
  for (const collection of args.collections) {
    for (const assetId of collection.assetIds) {
      const current = collectionMemberships.get(assetId) ?? [];
      current.push(collection);
      collectionMemberships.set(assetId, current);
    }
  }

  for (const asset of args.assets) {
    if (args.groupBy === "source") {
      ensureGroup(asset.sourceId, args.sourceById.get(asset.sourceId) || asset.sourceId).assets.push(asset);
      continue;
    }

    if (args.groupBy === "folder") {
      const key = asset.folderPath || "root";
      ensureGroup(key, asset.folderPath || "Root library bucket").assets.push(asset);
      continue;
    }

    if (args.groupBy === "status") {
      ensureGroup(asset.status, asset.status).assets.push(asset);
      continue;
    }

    if (args.groupBy === "tag") {
      const tags = asset.tags && asset.tags.length > 0 ? asset.tags : ["No tags"];
      for (const tag of tags) {
        ensureGroup(`tag:${tag}`, tag).assets.push(asset);
      }
      continue;
    }

    const memberships = collectionMemberships.get(asset.id) ?? [];
    if (memberships.length === 0) {
      ensureGroup("collection:none", "Not in a curated set").assets.push(asset);
      continue;
    }
    for (const collection of memberships) {
      ensureGroup(collection.id, collection.name).assets.push(asset);
    }
  }

  return [...groups.values()].sort((left, right) => {
    if (left.assets.length !== right.assets.length) {
      return right.assets.length - left.assets.length;
    }
    return left.label.localeCompare(right.label);
  });
}

export function AssetLibraryBrowser(props: {
  assets: AssetRecord[];
  sources: SourceRecord[];
  assetCollections: AssetCollectionRecord[];
}) {
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState("all");
  const [status, setStatus] = useState("all");
  const [programmingState, setProgrammingState] = useState("all");
  const [folderFilter, setFolderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [groupBy, setGroupBy] = useState<GroupByMode>("source");
  const [folderDraft, setFolderDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState(props.assetCollections[0]?.id ?? "");
  const [collectionNameDraft, setCollectionNameDraft] = useState(props.assetCollections[0]?.name ?? "");
  const [collectionDescriptionDraft, setCollectionDescriptionDraft] = useState(props.assetCollections[0]?.description ?? "");
  const [collectionColorDraft, setCollectionColorDraft] = useState(props.assetCollections[0]?.color ?? "#0e6d5a");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const sourceById = useMemo(
    () => new Map(props.sources.map((source) => [source.id, source.name] as const)),
    [props.sources]
  );

  const collectionMemberships = useMemo(() => {
    const memberships = new Map<string, AssetCollectionRecord[]>();
    for (const collection of props.assetCollections) {
      for (const assetId of collection.assetIds) {
        const current = memberships.get(assetId) ?? [];
        current.push(collection);
        memberships.set(assetId, current);
      }
    }
    return memberships;
  }, [props.assetCollections]);

  const filteredAssets = useMemo(
    () =>
      props.assets.filter((asset) => {
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

        if (collectionFilter !== "all") {
          const memberships = collectionMemberships.get(asset.id) ?? [];
          if (!memberships.some((collection) => collection.id === collectionFilter)) {
            return false;
          }
        }

        if (!query.trim()) {
          return true;
        }

        const haystack = [
          asset.title,
          asset.categoryName || "",
          asset.externalId || "",
          asset.path,
          asset.folderPath || "",
          ...(asset.tags || []),
          ...(collectionMemberships.get(asset.id)?.map((collection) => collection.name) ?? [])
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      }),
    [collectionFilter, collectionMemberships, folderFilter, programmingState, props.assets, query, sourceId, status, tagFilter]
  );

  const assetGroups = useMemo(
    () =>
      buildGroups({
        assets: filteredAssets,
        collections: props.assetCollections,
        groupBy,
        sourceById
      }),
    [filteredAssets, groupBy, props.assetCollections, sourceById]
  );

  const selectedAssets = useMemo(
    () => props.assets.filter((asset) => selectedIds.includes(asset.id)),
    [props.assets, selectedIds]
  );

  function selectCollection(collection: AssetCollectionRecord) {
    setActiveCollectionId(collection.id);
    setCollectionNameDraft(collection.name);
    setCollectionDescriptionDraft(collection.description);
    setCollectionColorDraft(collection.color);
  }

  async function applyBulkAction(action: BulkAction) {
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

  async function applyCuratedSetMembership(mode: "add_to_curated_set" | "remove_from_curated_set") {
    const response = await fetch("/api/assets/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: mode,
        assetIds: selectedIds,
        collectionId: activeCollectionId
      })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update curated set membership.");
      return;
    }

    setMessage(payload.message ?? "Curated set membership updated.");
    setSelectedIds([]);
    router.refresh();
  }

  async function saveCuratedSet() {
    const response = await fetch("/api/asset-collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: activeCollectionId || undefined,
        name: collectionNameDraft,
        description: collectionDescriptionDraft,
        color: collectionColorDraft,
        assetIds: activeCollectionId ? undefined : selectedIds
      })
    });

    const payload = (await response.json()) as { id?: string; message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not save curated set.");
      return;
    }

    setActiveCollectionId(payload.id ?? activeCollectionId);
    setMessage(payload.message ?? "Curated set saved.");
    router.refresh();
  }

  async function deleteCuratedSet() {
    if (!activeCollectionId) {
      setError("Choose a curated set first.");
      return;
    }

    const response = await fetch(`/api/asset-collections/${activeCollectionId}`, {
      method: "DELETE"
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not delete curated set.");
      return;
    }

    setActiveCollectionId("");
    setMessage(payload.message ?? "Curated set deleted.");
    router.refresh();
  }

  return (
    <div className="stack-form">
      <div className="form-grid">
        <label>
          <span className="label">Search assets</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Title, category, tag, or curated set..." value={query} />
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
        <label>
          <span className="label">Curated set</span>
          <select onChange={(event) => setCollectionFilter(event.target.value)} value={collectionFilter}>
            <option value="all">All curated sets</option>
            {props.assetCollections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Group by</span>
          <select onChange={(event) => setGroupBy(event.target.value as GroupByMode)} value={groupBy}>
            <option value="none">No grouping</option>
            <option value="source">Source</option>
            <option value="folder">Folder</option>
            <option value="tag">Tag</option>
            <option value="curated-set">Curated set</option>
            <option value="status">Status</option>
          </select>
        </label>
      </div>

      <div className="subtle">
        Showing {filteredAssets.length} of {props.assets.length} assets across {assetGroups.length} library view
        {assetGroups.length === 1 ? "" : "s"}.
      </div>

      <div className="subtle">
        {selectedAssets.length > 0
          ? `Selected ${selectedAssets.length} asset(s): ${selectedAssets.map((asset) => asset.title).join(", ")}`
          : "No assets selected yet."}
      </div>

      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}

      <div className="panel panel-compact">
        <div className="stack-form">
          <div>
            <strong>Curated sets</strong>
            <div className="subtle">
              Curated sets let operators pin reusable groups of assets without rewriting folders or tags. New sets can
              start with the currently selected assets.
            </div>
          </div>
          <div className="chip-grid">
            {props.assetCollections.map((collection) => (
              <button
                className={`collection-chip${activeCollectionId === collection.id ? " collection-chip-active" : ""}`}
                key={collection.id}
                onClick={() => {
                  selectCollection(collection);
                  setError("");
                  setMessage("");
                }}
                style={{ ["--collection-color" as string]: collection.color }}
                type="button"
              >
                <span>{collection.name}</span>
                <span className="subtle">{collection.assetIds.length}</span>
              </button>
            ))}
            {props.assetCollections.length === 0 ? <span className="subtle">No curated sets yet.</span> : null}
          </div>
          <div className="form-grid">
            <label>
              <span className="label">Set name</span>
              <input
                onChange={(event) => setCollectionNameDraft(event.target.value)}
                placeholder="Weekend marathon starters"
                value={collectionNameDraft}
              />
            </label>
            <label>
              <span className="label">Accent color</span>
              <input onChange={(event) => setCollectionColorDraft(event.target.value)} placeholder="#0e6d5a" value={collectionColorDraft} />
            </label>
          </div>
          <label>
            <span className="label">Description</span>
            <input
              onChange={(event) => setCollectionDescriptionDraft(event.target.value)}
              placeholder="Starter pack for sponsor-safe weekend replays"
              value={collectionDescriptionDraft}
            />
          </label>
          <div className="toggle-row">
            <button
              className="button"
              disabled={isPending || !collectionNameDraft.trim()}
              onClick={() => {
                setError("");
                setMessage("");
                startTransition(() => void saveCuratedSet());
              }}
              type="button"
            >
              {isPending ? "Saving..." : activeCollectionId ? "Update curated set" : "Create curated set"}
            </button>
            <button
              className="button secondary"
              disabled={isPending || !activeCollectionId || selectedIds.length === 0}
              onClick={() => {
                setError("");
                setMessage("");
                startTransition(() => void applyCuratedSetMembership("add_to_curated_set"));
              }}
              type="button"
            >
              Add selected to set
            </button>
            <button
              className="button secondary"
              disabled={isPending || !activeCollectionId || selectedIds.length === 0}
              onClick={() => {
                setError("");
                setMessage("");
                startTransition(() => void applyCuratedSetMembership("remove_from_curated_set"));
              }}
              type="button"
            >
              Remove selected from set
            </button>
            <button
              className="button secondary"
              disabled={isPending || !activeCollectionId}
              onClick={() => {
                setError("");
                setMessage("");
                startTransition(() => void deleteCuratedSet());
              }}
              type="button"
            >
              Delete curated set
            </button>
            <button
              className="button secondary"
              disabled={isPending}
              onClick={() => {
                setActiveCollectionId("");
                setCollectionNameDraft("");
                setCollectionDescriptionDraft("");
                setCollectionColorDraft("#0e6d5a");
              }}
              type="button"
            >
              New set draft
            </button>
          </div>
        </div>
      </div>

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

      <div className="library-group-stack">
        {assetGroups.map((group) => (
          <section className="library-group" key={group.key}>
            <div className="library-group-header">
              <div>
                <strong>{group.label}</strong>
                <div className="subtle">{group.assets.length} asset(s)</div>
              </div>
            </div>
            <div className="asset-card-grid">
              {group.assets.map((asset) => {
                const sourceName = sourceById.get(asset.sourceId) || asset.sourceId;
                const selected = selectedIds.includes(asset.id);
                const memberships = collectionMemberships.get(asset.id) ?? [];
                return (
                  <article className="asset-card" key={`${group.key}:${asset.id}`}>
                    <div className="asset-card-thumbnail">
                      <Image
                        alt={`Thumbnail for ${asset.title}`}
                        fill
                        loading="lazy"
                        sizes="(max-width: 900px) 100vw, 180px"
                        src={`/api/assets/${asset.id}/thumbnail`}
                        unoptimized
                      />
                    </div>
                    <div className="asset-card-body">
                      <label className={`chip-toggle${selected ? " chip-toggle-active" : ""}`}>
                        <input
                          checked={selected}
                          onChange={(event) =>
                            setSelectedIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, asset.id])].sort((left, right) => left.localeCompare(right))
                                : current.filter((id) => id !== asset.id)
                            )
                          }
                          type="checkbox"
                        />
                        <span>Select asset</span>
                      </label>
                      <strong className="truncate-title">{asset.title}</strong>
                      <div className="subtle">
                        {sourceName} · {asset.status} · {formatDuration(asset)}
                      </div>
                      <div className="subtle">
                        {asset.categoryName || "No source category"}
                        {asset.publishedAt ? ` · ${asset.publishedAt.slice(0, 10)}` : ""}
                      </div>
                      <div className="subtle">
                        Folder: {asset.folderPath || "root"} · Tags:{" "}
                        {asset.tags && asset.tags.length > 0 ? asset.tags.join(", ") : "none"}
                      </div>
                      <div className="subtle">
                        {asset.includeInProgramming ? "Included in programming" : "Excluded from programming"} ·{" "}
                        {asset.isGlobalFallback ? `Global fallback (priority ${asset.fallbackPriority})` : "No global fallback flag"}
                      </div>
                      <div className="chip-grid">
                        {memberships.map((collection) => (
                          <span
                            className="collection-chip collection-chip-static"
                            key={collection.id}
                            style={{ ["--collection-color" as string]: collection.color }}
                          >
                            {collection.name}
                          </span>
                        ))}
                        {memberships.length === 0 ? <span className="subtle">No curated set</span> : null}
                      </div>
                      <div className="subtle asset-path">{asset.path}</div>
                      <div>
                        <Link className="subtle-link" href={`/assets/${asset.id}`}>
                          Open asset detail
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {filteredAssets.length === 0 ? (
          <div className="item">
            <strong>No assets match the current filters</strong>
            <div className="subtle">Try a different source, curated set, folder, or search query.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
