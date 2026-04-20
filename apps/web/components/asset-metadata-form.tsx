"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { AssetRecord } from "@/lib/server/state";

function parseHashtagsJson(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) =>
        String(entry ?? "")
          .trim()
          .replace(/^#+/, "")
          .replace(/\s+/g, "")
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseHashtagsText(value: string): string[] {
  return value
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .replace(/^#+/, "")
        .replace(/\s+/g, "")
    )
    .filter(Boolean);
}

export function AssetMetadataForm({
  asset,
  categorySuggestions
}: {
  asset: AssetRecord;
  categorySuggestions: string[];
}) {
  const categoryListId = useId();
  const [title, setTitle] = useState(asset.title);
  const [titlePrefix, setTitlePrefix] = useState(asset.titlePrefix || "");
  const [categoryName, setCategoryName] = useState(asset.categoryName || "");
  const [hashtagsText, setHashtagsText] = useState(parseHashtagsJson(asset.hashtagsJson).join(", "));
  const [platformNotes, setPlatformNotes] = useState(asset.platformNotes || "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function save() {
    const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        titlePrefix,
        categoryName,
        hashtags: parseHashtagsText(hashtagsText),
        platformNotes
      })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update asset metadata.");
      return;
    }

    setMessage(payload.message ?? "Asset metadata updated.");
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
      <label>
        <span className="label">Title</span>
        <input maxLength={200} onChange={(event) => setTitle(event.target.value)} required value={title} />
      </label>
      <label>
        <span className="label">Title prefix</span>
        <input
          maxLength={20}
          onChange={(event) => setTitlePrefix(event.target.value)}
          placeholder="e.g. Replay:"
          value={titlePrefix}
        />
      </label>
      <label>
        <span className="label">Category</span>
        <input
          list={categoryListId}
          maxLength={120}
          onChange={(event) => setCategoryName(event.target.value)}
          placeholder="Just Chatting"
          value={categoryName}
        />
        <datalist id={categoryListId}>
          {categorySuggestions.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </label>
      <label>
        <span className="label">Hashtags</span>
        <input
          onChange={(event) => setHashtagsText(event.target.value)}
          placeholder="stream247, replay, marathon"
          value={hashtagsText}
        />
      </label>
      <label>
        <span className="label">Operator notes</span>
        <textarea
          maxLength={1000}
          onChange={(event) => setPlatformNotes(event.target.value)}
          placeholder="Platform-specific reminders for this asset"
          rows={3}
          value={platformNotes}
        />
      </label>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save metadata"}
      </button>
    </form>
  );
}
