"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function PresenceCheckInForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage("");
        setError("");

        const formData = new FormData(event.currentTarget);

        startTransition(async () => {
          const response = await fetch("/api/moderation/presence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              actor: String(formData.get("actor") || "admin"),
              input: String(formData.get("input") || "")
            })
          });

          const payload = (await response.json()) as { message?: string; window?: { expiresAt: string } };

          if (!response.ok) {
            setError(payload.message ?? "Check-in failed.");
            return;
          }

          setMessage(payload.message ?? `Presence active until ${payload.window?.expiresAt ?? "unknown"}.`);
          router.refresh();
        });
      }}
    >
      <input defaultValue="admin" name="actor" placeholder="actor" />
      <input defaultValue="!here 30" name="input" placeholder="!here 30" />
      <button className="button button-secondary" disabled={isPending} type="submit">
        {isPending ? "Checking in..." : "Create presence window"}
      </button>
      {message ? <span>{message}</span> : null}
      {error ? <span className="danger">{error}</span> : null}
    </form>
  );
}
