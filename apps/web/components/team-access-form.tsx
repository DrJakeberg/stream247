"use client";

import type { UserRole } from "@/lib/server/state";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const roles: UserRole[] = ["admin", "operator", "moderator", "viewer"];

export function TeamAccessForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage("");
        setError("");
        const formData = new FormData(event.currentTarget);

        startTransition(async () => {
          const response = await fetch("/api/team/access", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              twitchLogin: String(formData.get("twitchLogin") || ""),
              role: String(formData.get("role") || "viewer")
            })
          });

          const body = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(body.message ?? "Could not add team access.");
            return;
          }

          setMessage(body.message ?? "Saved.");
          router.refresh();
        });
      }}
    >
      <label>
        <span className="label">Twitch login</span>
        <input name="twitchLogin" required placeholder="moderator_name" />
      </label>
      <label>
        <span className="label">Role</span>
        <select className="select" defaultValue="moderator" name="role">
          {roles.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </label>
      {message ? <p>{message}</p> : null}
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Grant Twitch access"}
      </button>
    </form>
  );
}
