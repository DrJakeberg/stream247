"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type VideoSourceListEntry = { id: string; name: string; urlPresent: boolean; updatedAt: string };

/**
 * Stored external video sources for the scene's source layer (M57).
 *
 * The feed address is write-only on purpose: it goes in encrypted, the list only ever shows that
 * an address is stored, and leaving the field empty on a later save keeps whatever is stored —
 * the same keep-on-empty custody every other stored secret follows.
 */
export function VideoSourceSettingsForm(props: { videoSources: VideoSourceListEntry[] }) {
  const [sources, setSources] = useState(props.videoSources);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (body: Record<string, unknown>, method: "PUT" | "DELETE") => {
    setError("");
    setMessage("");
    startTransition(async () => {
      const response = await fetch("/api/overlay/video-sources", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as { message?: string; videoSources?: VideoSourceListEntry[] };
      if (!response.ok) {
        setError(payload.message ?? "Could not save the video source.");
        return;
      }
      if (payload.videoSources) {
        setSources(payload.videoSources);
      }
      setMessage(payload.message ?? "Saved.");
      setName("");
      setUrl("");
      setEditingId("");
      router.refresh();
    });
  };

  return (
    <div className="stack-form">
      <p className="subtle">
        Cameras and feeds a scene's video source layer can show. The feed address is stored encrypted and never
        shown again — this list only says whether one is stored. Saving with an empty address keeps the stored one.
      </p>
      <div className="form-grid">
        <label>
          <span className="label">Name</span>
          <input onChange={(event) => setName(event.target.value)} placeholder="e.g. Studio camera" value={name} />
        </label>
        <label>
          <span className="label">Feed address</span>
          <input
            autoComplete="off"
            onChange={(event) => setUrl(event.target.value)}
            placeholder={editingId ? "Leave empty to keep the stored address" : "e.g. a camera stream URL"}
            value={url}
          />
        </label>
      </div>
      <div className="inline-form">
        <button
          className="button secondary"
          disabled={isPending || name.trim() === ""}
          onClick={() => submit({ id: editingId || undefined, name, url }, "PUT")}
          type="button"
        >
          {isPending ? "Saving..." : editingId ? "Save video source" : "Add video source"}
        </button>
        {editingId ? (
          <button
            className="button secondary"
            disabled={isPending}
            onClick={() => {
              setEditingId("");
              setName("");
              setUrl("");
            }}
            type="button"
          >
            Cancel
          </button>
        ) : null}
      </div>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <div className="list">
        {sources.length > 0 ? (
          sources.map((source) => (
            <div className="item" key={source.id}>
              <strong>{source.name}</strong>
              <div className="subtle">
                {source.urlPresent ? "Feed address stored." : "No feed address stored yet."}
                {source.updatedAt ? ` Updated ${source.updatedAt}.` : ""}
              </div>
              <div className="inline-form" style={{ marginTop: 8 }}>
                <button
                  className="button secondary"
                  disabled={isPending}
                  onClick={() => {
                    setEditingId(source.id);
                    setName(source.name);
                    setUrl("");
                  }}
                  type="button"
                >
                  Edit
                </button>
                <button
                  className="button secondary"
                  disabled={isPending}
                  onClick={() => submit({ id: source.id }, "DELETE")}
                  type="button"
                >
                  Remove
                </button>
                {source.urlPresent ? (
                  <button
                    className="button secondary"
                    disabled={isPending}
                    onClick={() => submit({ id: source.id, name: source.name, clearUrl: true }, "PUT")}
                    type="button"
                  >
                    Forget stored address
                  </button>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="subtle">No video sources stored yet.</div>
        )}
      </div>
    </div>
  );
}
