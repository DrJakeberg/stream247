"use client";

import { useState, useTransition } from "react";

export function PlayoutActionForm() {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function runAction(path: string) {
    setError("");
    const response = await fetch(path, { method: "POST" });
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "Playout action failed.");
      return;
    }

    window.location.reload();
  }

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <button
        className="button secondary"
        disabled={isPending}
        onClick={() => startTransition(() => void runAction("/api/playout/restart"))}
        type="button"
      >
        Restart encoder
      </button>
      <button
        className="button secondary"
        disabled={isPending}
        onClick={() => startTransition(() => void runAction("/api/playout/fallback"))}
        type="button"
      >
        Switch to fallback
      </button>
      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}
