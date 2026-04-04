"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function PoolDeleteForm(props: { id: string; name: string }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="stack-form">
      <button
        className="button secondary"
        disabled={isPending}
        onClick={() => {
          if (!window.confirm(`Delete pool ${props.name}? Blocks targeting this pool will also be removed.`)) {
            return;
          }

          startTransition(async () => {
            const response = await fetch("/api/pools", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: props.id })
            });

            const payload = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(payload.message ?? "Could not delete pool.");
              return;
            }

            router.refresh();
          });
        }}
        type="button"
      >
        {isPending ? "Deleting..." : "Delete pool"}
      </button>
      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}
