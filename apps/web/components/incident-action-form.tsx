"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function IncidentActionForm(props: { fingerprint: string; acknowledgedAt?: string; status: "open" | "resolved" }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      {props.status === "open" && !props.acknowledgedAt ? (
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => {
            setError("");
            startTransition(async () => {
              const response = await fetch("/api/incidents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  fingerprint: props.fingerprint,
                  action: "acknowledge"
                })
              });

              if (!response.ok) {
                const payload = (await response.json()) as { message?: string };
                setError(payload.message ?? "Could not acknowledge incident.");
                return;
              }

              router.refresh();
            });
          }}
          type="button"
        >
          Acknowledge
        </button>
      ) : null}
      {props.status === "open" ? (
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => {
            setError("");
            startTransition(async () => {
              const response = await fetch("/api/incidents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  fingerprint: props.fingerprint,
                  action: "resolve"
                })
              });

              if (!response.ok) {
                const payload = (await response.json()) as { message?: string };
                setError(payload.message ?? "Could not resolve incident.");
                return;
              }

              router.refresh();
            });
          }}
          type="button"
        >
          Resolve
        </button>
      ) : null}
      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}
