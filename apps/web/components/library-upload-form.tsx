"use client";

import { useRouter } from "next/navigation";
import { LIBRARY_MEDIA_FILE_EXTENSIONS } from "@stream247/core";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";

export function LibraryUploadForm() {
  const [subfolder, setSubfolder] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { pushToast } = useToast();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        const form = event.currentTarget;
        const formData = new FormData(form);

        startTransition(async () => {
          const response = await fetch("/api/library/uploads", {
            method: "POST",
            body: formData
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            const nextError = payload.message ?? "Could not upload media files.";
            setError(nextError);
            pushToast({ title: "Upload failed.", description: nextError, tone: "error" });
            return;
          }

          pushToast({ title: payload.message ?? "Upload complete.", tone: "success" });
          setSubfolder("");
          form.reset();
          router.refresh();
        });
      }}
    >
      <label>
        <span className="label label-with-info">Media files<InfoTip text="Copied into the channel's media library and turned into playable assets by the worker's next library scan, usually within a few minutes. Only the container formats the scan ingests are accepted — mp4, mkv, mov, m4v, webm — so nothing lands on disk that the channel could not play. Several files can be picked at once; a name already taken is stored under a new one." /></span>
        <input accept={LIBRARY_MEDIA_FILE_EXTENSIONS.join(",")} multiple name="files" required type="file" />
      </label>
      <label>
        <span className="label label-with-info">Optional subfolder<InfoTip text="Puts the files into this folder inside the media library instead of the default folder named uploads; slashes create nested folders and unusual characters become dashes. In the asset library the folder can be used as a filter, or as the grouping when you switch grouping to folder." /></span>
        <input
          name="subfolder"
          onChange={(event) => setSubfolder(event.target.value)}
          placeholder="e.g. weekend-replays/april"
          value={subfolder}
        />
      </label>
      <p className="subtle">
        Uploaded files land in the shared local media library and become playable within a few minutes.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Uploading..." : "Upload into local library"}
      </button>
    </form>
  );
}
