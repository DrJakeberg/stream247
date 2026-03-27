"use client";

import { useState, useTransition } from "react";

export function ScheduleBlockDeleteForm({ id }: { id: string }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        startTransition(async () => {
          const response = await fetch("/api/schedule/blocks", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
          });

          const body = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(body.message ?? "Could not delete schedule block.");
            return;
          }

          window.location.reload();
        });
      }}
    >
      {error ? <p className="danger">{error}</p> : null}
      <button className="button button-secondary" disabled={isPending} type="submit">
        {isPending ? "Removing..." : "Delete block"}
      </button>
    </form>
  );
}
