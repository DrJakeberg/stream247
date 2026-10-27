"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function TeamAccessRevokeForm(props: { id: string; twitchLogin: string }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        if (!window.confirm(`Remove access for ${props.twitchLogin}? Their open sessions end with their next click.`)) {
          return;
        }

        startTransition(async () => {
          const response = await fetch("/api/team/access", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: props.id })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not remove access.");
            return;
          }

          router.refresh();
        });
      }}
    >
      {error ? <p className="danger">{error}</p> : null}
      <button className="button secondary" disabled={isPending} type="submit">
        {isPending ? "Removing..." : "Remove access"}
      </button>
    </form>
  );
}
