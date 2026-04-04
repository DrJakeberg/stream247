"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      className="button button-secondary"
      type="button"
      onClick={() =>
        startTransition(async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          router.replace("/login");
        })
      }
    >
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
