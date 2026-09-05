"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import type { PoolRecord, SourceRecord } from "@/lib/server/state";

export function PoolForm(props: {
  sources: SourceRecord[];
  assets: Array<{ id: string; title: string; sourceId: string; status: string }>;
  pool?: PoolRecord;
}) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const isEditing = Boolean(props.pool);
  const router = useRouter();
  const { pushToast } = useToast();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        const formData = new FormData(event.currentTarget);
        const sourceIds = formData.getAll("sourceIds").map((value) => String(value));

        startTransition(async () => {
          const response = await fetch("/api/pools", {
            method: isEditing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: String(formData.get("id") || ""),
              name: String(formData.get("name") || ""),
              sourceIds,
              insertAssetId: String(formData.get("insertAssetId") || ""),
              insertEveryItems: Number(formData.get("insertEveryItems") || 0),
              audioLaneAssetId: String(formData.get("audioLaneAssetId") || ""),
              audioLaneVolumePercent: Number(formData.get("audioLaneVolumePercent") || 100)
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            const nextError = payload.message ?? "Could not save pool.";
            setError(nextError);
            pushToast({ title: "Pool could not be saved.", description: nextError, tone: "error" });
            return;
          }

          pushToast({ title: payload.message ?? "Pool saved.", tone: "success" });
          router.refresh();
        });
      }}
    >
      {props.pool ? <input name="id" type="hidden" value={props.pool.id} /> : null}
      <label>
        <span className="label label-with-info">Pool name<InfoTip text="How the pool appears when you pick it for a schedule block or programming template, and in the pool list." /></span>
        <input defaultValue={props.pool?.name ?? ""} name="name" placeholder="Morning archive" required />
      </label>
      <label>
        <span className="label label-with-info">Included sources<InfoTip text="Ready assets from these sources that are included in programming join the rotation, oldest published first, looping and picking up where the last block left off; the insert and replacement-audio assets stay out. At least one source is required." /></span>
        <select defaultValue={props.pool?.sourceIds ?? []} multiple name="sourceIds" size={Math.min(8, Math.max(3, props.sources.length))}>
          {props.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          <span className="label label-with-info">Automatic insert asset<InfoTip text="Played between regular items at the cadence set beside it; above 0 it leaves the normal rotation, at 0 the inserts stop and it plays as an ordinary item again. Blocks with cue-point times but no cue-point asset of their own play it at those times whatever the cadence, and it must be included in programming or it is skipped." /></span>
          <select defaultValue={props.pool?.insertAssetId ?? ""} name="insertAssetId">
            <option value="">No automatic insert</option>
            {props.assets
              .filter((asset) => asset.status === "ready")
              .map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span className="label label-with-info">Insert every N scheduled items<InfoTip text="After this many regular items the insert asset plays once and the count starts again. 0 turns automatic inserts off; the most you can set is 100." /></span>
          <input
            defaultValue={props.pool?.insertEveryItems ?? 0}
            min="0"
            name="insertEveryItems"
            placeholder="0 disables"
            step="1"
            type="number"
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label label-with-info">Replacement audio<InfoTip text="While a schedule block using this pool is on air, regular items and manual-next picks have their own sound dropped and this asset plays instead, looping for as long as the item runs; automatic inserts and cue-point plays keep their own sound. Only ready items from Local media library or Direct media URL sources are accepted, and the chosen asset leaves the pool's rotation." /></span>
          <select defaultValue={props.pool?.audioLaneAssetId ?? ""} name="audioLaneAssetId">
            <option value="">Use program audio</option>
            {props.assets
              .filter((asset) => asset.status === "ready")
              .map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span className="label label-with-info">Replacement audio level (%)<InfoTip text="100 plays the chosen audio as recorded, lower values turn it down, 0 mutes it. Ignored while Replacement audio is set to Use program audio." /></span>
          <input
            defaultValue={props.pool?.audioLaneVolumePercent ?? 100}
            min="0"
            max="100"
            name="audioLaneVolumePercent"
            step="1"
            type="number"
          />
        </label>
      </div>
      <p className="subtle">Pools currently use persistent round-robin playback across all ready assets from the selected sources.</p>
      <p className="subtle">
        Replacement audio plays instead of the programme sound whenever this pool is on air. Assets from Local media
        library or Direct media URL sources loop most reliably.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {/*
        Primary when this form creates a pool, secondary when it edits one that exists.
        The same component renders both, and the page shows one editor per pool — so styling it
        primary in either case gave the pools page four equally loud main actions, one of which was
        the real one.
      */}
      <button className={isEditing ? "button button-secondary" : "button"} disabled={isPending} type="submit">
        {isPending ? "Saving..." : isEditing ? "Update pool" : "Add pool"}
      </button>
    </form>
  );
}
