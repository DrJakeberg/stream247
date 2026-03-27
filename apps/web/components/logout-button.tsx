"use client";

import { useTransition } from "react";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className="button button-secondary"
      type="button"
      onClick={() =>
        startTransition(async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        })
      }
    >
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}

