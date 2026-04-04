"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ShowProfileDeleteForm(props: { id: string; name: string }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        if (!window.confirm(`Delete show profile ${props.name}? Existing blocks will keep their titles but lose the profile link.`)) {
          return;
        }

        startTransition(async () => {
          const response = await fetch("/api/shows", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: props.id })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not delete show profile.");
            return;
          }

          router.refresh();
        });
      }}
    >
      {error ? <p className="danger">{error}</p> : null}
      <button className="button secondary" disabled={isPending} type="submit">
        {isPending ? "Removing..." : "Delete show"}
      </button>
    </form>
  );
}
