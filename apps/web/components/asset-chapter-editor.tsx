"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatCuepointOffsetLabel, parseAssetChaptersJson, parseChapterOffsetInput } from "@stream247/core";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { AssetRecord } from "@/lib/server/state";

type ChapterRow = {
  offsetText: string;
  categoryName: string;
  title: string;
};

/**
 * Per-video chapter editor: each row is an offset at which the broadcast switches to that
 * chapter's category and stream title. Offsets are edited as text (seconds, mm:ss or hh:mm:ss)
 * and validated on save rather than on keystroke, so half-typed timecodes do not flash errors.
 */
export function AssetChapterEditor({ asset, categoryOptions }: { asset: AssetRecord; categoryOptions: string[] }) {
  const [rows, setRows] = useState<ChapterRow[]>(() =>
    parseAssetChaptersJson(asset.chaptersJson).map((chapter) => ({
      offsetText: formatCuepointOffsetLabel(chapter.offsetSeconds),
      categoryName: chapter.categoryName,
      title: chapter.title
    }))
  );
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { pushToast } = useToast();
  const durationSeconds = asset.durationSeconds ?? 0;
  const categorySelectOptions = [...new Set(["", ...categoryOptions, ...rows.map((row) => row.categoryName)])].map(
    (option) => ({ value: option, label: option || "Keep the video's category" })
  );

  function updateRow(index: number, patch: Partial<ChapterRow>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function validate(): { offsetSeconds: number; categoryName: string; title: string }[] | null {
    const chapters: { offsetSeconds: number; categoryName: string; title: string }[] = [];
    for (const [index, row] of rows.entries()) {
      const offsetSeconds = parseChapterOffsetInput(row.offsetText);
      if (offsetSeconds === null) {
        setError(`Chapter ${index + 1}: "${row.offsetText}" is not a valid offset (seconds, mm:ss or hh:mm:ss).`);
        return null;
      }
      if (durationSeconds > 0 && offsetSeconds >= durationSeconds) {
        setError(
          `Chapter ${index + 1} starts at ${formatCuepointOffsetLabel(offsetSeconds)}, beyond the video's duration of ${formatCuepointOffsetLabel(durationSeconds)}.`
        );
        return null;
      }
      if (row.title.trim() === "" && row.categoryName.trim() === "") {
        setError(`Chapter ${index + 1} needs a title or a category — an empty chapter would change nothing on air.`);
        return null;
      }
      chapters.push({ offsetSeconds, categoryName: row.categoryName, title: row.title });
    }
    return chapters;
  }

  async function save() {
    const chapters = validate();
    if (!chapters) {
      return;
    }

    const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapters })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      const nextError = payload.message ?? "Could not update the chapter list.";
      setError(nextError);
      pushToast({ title: "Chapters could not be saved.", description: nextError, tone: "error" });
      return;
    }

    pushToast({ title: payload.message ?? "Chapters updated.", tone: "success" });
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
      {rows.map((row, index) => (
        <fieldset className="stack-form" key={index} style={{ border: 0, margin: 0, padding: 0 }}>
          <Input
            label={`Chapter ${index + 1} offset`}
            hint={index === 0 ? "Seconds, mm:ss or hh:mm:ss into the video." : undefined}
            onChange={(value) => updateRow(index, { offsetText: value })}
            value={row.offsetText}
          />
          <Input
            label={`Chapter ${index + 1} stream title`}
            maxLength={200}
            onChange={(value) => updateRow(index, { title: value })}
            value={row.title}
          />
          <Select
            label={`Chapter ${index + 1} category`}
            onChange={(value) => updateRow(index, { categoryName: value })}
            options={categorySelectOptions}
            value={row.categoryName}
          />
          <button
            className="button button-secondary"
            onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
            type="button"
          >
            Remove chapter {index + 1}
          </button>
        </fieldset>
      ))}
      {rows.length === 0 ? (
        <p className="subtle">
          No chapters: the video keeps one category and one title for its whole runtime, exactly as before.
        </p>
      ) : null}
      {error ? <p className="danger">{error}</p> : null}
      <div className="chip-grid">
        <button
          className="button button-secondary"
          onClick={() => setRows((current) => [...current, { offsetText: "", categoryName: "", title: "" }])}
          type="button"
        >
          Add chapter
        </button>
        <button className="button" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save chapters"}
        </button>
      </div>
    </form>
  );
}
