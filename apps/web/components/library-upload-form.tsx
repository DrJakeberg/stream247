"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
        <span className="label">Media files</span>
        <input accept=".mp4,.mkv,.mov,.m4v,.webm,.avi,.mp3,.aac,.flac,.wav" multiple name="files" required type="file" />
      </label>
      <label>
        <span className="label">Optional subfolder</span>
        <input
          name="subfolder"
          onChange={(event) => setSubfolder(event.target.value)}
          placeholder="e.g. weekend-replays/april"
          value={subfolder}
        />
      </label>
      <p className="subtle">
        Uploaded files land in the shared local media library and become available to the local-library source on the next worker cycle.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Uploading..." : "Upload into local library"}
      </button>
    </form>
  );
}
