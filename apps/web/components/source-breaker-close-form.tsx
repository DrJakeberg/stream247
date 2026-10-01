"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SourceBreakerCloseForm(props: { sourceId: string }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function closeBreaker() {
    const response = await fetch("/api/sources/breaker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: props.sourceId })
    });

    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not close the source breaker.");
      return;
    }

    setMessage(payload.message ?? "The source is back in the pool rotation.");
    router.refresh();
  }

  return (
    <div className="stack-form">
      <button
        className="button secondary"
        disabled={isPending}
        onClick={() => {
          setError("");
          setMessage("");
          startTransition(() => void closeBreaker());
        }}
        type="button"
      >
        {isPending ? "Closing..." : "Close breaker now"}
      </button>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
    </div>
  );
}
