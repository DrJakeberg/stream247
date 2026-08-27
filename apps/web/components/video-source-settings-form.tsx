"use client";

import { describeSourceLiveState } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type VideoSourceListEntry = {
  id: string;
  name: string;
  urlPresent: boolean;
  ingestKind: "pull" | "push";
  publishKeyPresent: boolean;
  /** The worker's last attach decision, as its own decision word; "" until one was ever made. */
  liveState: string;
  liveStateAt: string;
  liveRetryAt: string;
  updatedAt: string;
};

/**
 * Stored external video sources for the scene's source layer (M57).
 *
 * The feed address is write-only on purpose: it goes in encrypted, the list only ever shows that
 * an address is stored, and leaving the field empty on a later save keeps whatever is stored —
 * the same keep-on-empty custody every other stored secret follows. A pushed source works the
 * other way around — the camera sends to this server — and its publish key appears exactly once,
 * in the response that issued it; afterwards the list only says that one exists.
 */
export function VideoSourceSettingsForm(props: { videoSources: VideoSourceListEntry[] }) {
  const [sources, setSources] = useState(props.videoSources);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [ingestKind, setIngestKind] = useState<"pull" | "push">("pull");
  const [editingId, setEditingId] = useState("");
  const [issuedKey, setIssuedKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // What playback last decided about each pushed source, as a sentence. Projected here rather than
  // on the server so the countdown inside a cooldown state runs against the reader's own clock
  // instead of against whenever the page happened to be rendered. A fetched source is never a live
  // input, so it gets no line at all — one would describe a decision nobody makes about it.
  const liveStateBySource = new Map(
    sources.map((source) => [
      source.id,
      source.ingestKind === "push"
        ? describeSourceLiveState({ state: source.liveState, retryAt: source.liveRetryAt })
        : ""
    ])
  );

  const submit = (body: Record<string, unknown>, method: "PUT" | "DELETE") => {
    setError("");
    setMessage("");
    setIssuedKey("");
    startTransition(async () => {
      const response = await fetch("/api/overlay/video-sources", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as {
        message?: string;
        videoSources?: VideoSourceListEntry[];
        publishKey?: string;
      };
      if (!response.ok) {
        setError(payload.message ?? "Could not save the video source.");
        return;
      }
      if (payload.videoSources) {
        setSources(payload.videoSources);
      }
      if (payload.publishKey) {
        // Held only in this component's state, until the next action replaces it.
        setIssuedKey(payload.publishKey);
      }
      setMessage(payload.message ?? "Saved.");
      setName("");
      setUrl("");
      setIngestKind("pull");
      setEditingId("");
      router.refresh();
    });
  };

  return (
    <div className="stack-form">
      <p className="subtle">
        Cameras and feeds the scene layers can show. The feed address is stored encrypted and never
        shown again — this list only says whether one is stored. Saving with an empty address keeps the stored one.
      </p>
      {/* Folded like the repair actions on the live page: adding a feed is an occasional job, and
          the scene page's control budget is a ratchet worth keeping. Editing reuses this form, so
          it opens itself when a source is being edited. */}
      <details className="disclosure" open={editingId !== ""}>
        <summary>{editingId ? "Edit video source" : "Add video source"}</summary>
        <div className="stack-form" style={{ marginTop: 8 }}>
          <div className="form-grid">
            <label>
              <span className="label">Name</span>
              <input onChange={(event) => setName(event.target.value)} placeholder="e.g. Studio camera" value={name} />
            </label>
            <label>
              <span className="label">How the picture arrives</span>
              <select
                onChange={(event) => setIngestKind(event.target.value === "push" ? "push" : "pull")}
                value={ingestKind}
              >
                <option value="pull">This server fetches a stream address</option>
                <option value="push">The camera sends to this server</option>
              </select>
            </label>
            {ingestKind === "pull" ? (
              <label>
                <span className="label">Feed address</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={editingId ? "Leave empty to keep the stored address" : "e.g. a camera stream URL"}
                  value={url}
                />
              </label>
            ) : (
              <p className="subtle">
                Saving creates a publish key for the camera. It is shown once, right here — copy it
                then, because afterwards this page only remembers that one exists.
              </p>
            )}
          </div>
          <div className="inline-form">
            <button
              className="button secondary"
              disabled={isPending || name.trim() === ""}
              onClick={() =>
                submit(
                  ingestKind === "push"
                    ? { id: editingId || undefined, name, ingestKind }
                    : { id: editingId || undefined, name, ingestKind, url },
                  "PUT"
                )
              }
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
        </div>
      </details>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      {issuedKey ? (
        <p>
          Publish key: <code>{issuedKey}</code>
        </p>
      ) : null}
      <div className="list">
        {sources.length > 0 ? (
          sources.map((source) => (
            <div className="item" key={source.id}>
              <strong>{source.name}</strong>
              <div className="subtle">
                {source.ingestKind === "push"
                  ? source.publishKeyPresent
                    ? "The camera sends to this server. A publish key is stored."
                    : "The camera sends to this server. No publish key yet."
                  : source.urlPresent
                    ? "Feed address stored."
                    : "No feed address stored yet."}
                {source.updatedAt ? ` Updated ${source.updatedAt}.` : ""}
              </div>
              {/* The last thing playback decided about this source, in words (M57 stage 2, Etappe
                  E). Empty until playback has decided once — an invented "not live" would be a
                  claim rather than an observation. */}
              {liveStateBySource.get(source.id) ? (
                <div className="subtle">{liveStateBySource.get(source.id)}</div>
              ) : null}
              <div className="inline-form" style={{ marginTop: 8 }}>
                <button
                  className="button secondary"
                  disabled={isPending}
                  onClick={() => {
                    setEditingId(source.id);
                    setName(source.name);
                    setUrl("");
                    setIngestKind(source.ingestKind);
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
                {source.ingestKind === "push" ? (
                  <button
                    className="button secondary"
                    disabled={isPending}
                    onClick={() =>
                      submit(
                        { id: source.id, name: source.name, ingestKind: "push", rotatePublishKey: true },
                        "PUT"
                      )
                    }
                    type="button"
                  >
                    New publish key
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
