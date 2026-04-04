"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SourceCreateForm() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");

        const formData = new FormData(event.currentTarget);
        const name = String(formData.get("name") || "");
        const connectorKind = String(formData.get("connectorKind") || "");
        const externalUrl = String(formData.get("externalUrl") || "");

        startTransition(async () => {
          const response = await fetch("/api/sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, connectorKind, externalUrl })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not save source.");
            return;
          }

          setMessage(payload.message ?? "Source saved.");
          router.refresh();
        });
      }}
    >
      <label>
        <span className="label">Display name</span>
        <input name="name" required placeholder="Main playlist mirror" />
      </label>
      <label>
        <span className="label">Connector type</span>
        <select defaultValue="direct-media" name="connectorKind">
          <option value="local-library">Local media library</option>
          <option value="direct-media">Direct media URL</option>
          <option value="youtube-playlist">YouTube playlist</option>
          <option value="youtube-channel">YouTube channel</option>
          <option value="twitch-vod">Twitch VOD</option>
          <option value="twitch-channel">Twitch channel</option>
        </select>
      </label>
      <label>
        <span className="label">External URL</span>
        <input name="externalUrl" placeholder="https://..." />
      </label>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Add source"}
      </button>
    </form>
  );
}
