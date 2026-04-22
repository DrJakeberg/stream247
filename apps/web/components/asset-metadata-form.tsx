"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { HashtagChipInput } from "@/components/hashtag-chip-input";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import {
  buildAssetMetadataTitlePrefix,
  isReplayTitlePrefix,
  parseAssetHashtagsJson
} from "@/lib/asset-metadata";
import type { AssetRecord } from "@/lib/server/state";

export function AssetMetadataForm({
  asset,
  categoryOptions
}: {
  asset: AssetRecord;
  categoryOptions: string[];
}) {
  const [title, setTitle] = useState(asset.title);
  const [replayEnabled, setReplayEnabled] = useState(isReplayTitlePrefix(asset.titlePrefix));
  const [categoryName, setCategoryName] = useState(asset.categoryName || "");
  const [hashtags, setHashtags] = useState(parseAssetHashtagsJson(asset.hashtagsJson));
  const [platformNotes, setPlatformNotes] = useState(asset.platformNotes || "");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { pushToast } = useToast();
  const hasLegacyPrefix = Boolean(asset.titlePrefix?.trim()) && !isReplayTitlePrefix(asset.titlePrefix);
  const selectOptions = useMemo(() => {
    const nextOptions = [...new Set(["", ...categoryOptions, asset.categoryName || ""])];

    return nextOptions.map((option) => ({
      value: option,
      label: option || "No category override"
    }));
  }, [asset.categoryName, categoryOptions]);

  async function save() {
    const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        titlePrefix: buildAssetMetadataTitlePrefix({
          replayEnabled,
          existingPrefix: asset.titlePrefix || ""
        }),
        categoryName,
        hashtags,
        platformNotes
      })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      const nextError = payload.message ?? "Could not update asset metadata.";
      setError(nextError);
      pushToast({ title: "Asset metadata could not be saved.", description: nextError, tone: "error" });
      return;
    }

    pushToast({ title: payload.message ?? "Asset metadata updated.", tone: "success" });
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(() => void save());
      }}
    >
      <Input label="Title" maxLength={200} onChange={setTitle} required value={title} />
      <div className="field-stack field-stack-full">
        <span className="label">Replay</span>
        <label className={`chip-toggle${replayEnabled ? " chip-toggle-active" : ""}`}>
          <input checked={replayEnabled} onChange={(event) => setReplayEnabled(event.target.checked)} type="checkbox" />
          <span>Prepend “Replay:” in the broadcast title</span>
        </label>
        <span className="field-meta">
          <span className="field-hint">
            {hasLegacyPrefix
              ? `Legacy prefix “${asset.titlePrefix}” stays preserved until you enable Replay.`
              : "The worker builds the broadcast title. Operators never type the prefix manually."}
          </span>
        </span>
      </div>
      <Select
        hint="Category options come from the current show profiles."
        label="Category"
        onChange={setCategoryName}
        options={selectOptions}
        value={categoryName}
      />
      <HashtagChipInput
        hint="Used for Twitch title composition. Tags are sanitized before save."
        label="Hashtags"
        onChange={setHashtags}
        placeholder="Type a hashtag and press Enter"
        values={hashtags}
      />
      <Textarea
        hint="Operator-facing notes only. These never render to viewers."
        label="Operator notes"
        maxLength={1000}
        onChange={setPlatformNotes}
        placeholder="Platform-specific reminders for this asset"
        rows={4}
        showCharCount
        value={platformNotes}
      />
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save metadata"}
      </button>
    </form>
  );
}
