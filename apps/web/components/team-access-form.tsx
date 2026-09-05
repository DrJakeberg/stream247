"use client";

import type { UserRole } from "@/lib/server/state";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { humanizeOptionValue } from "@/lib/option-labels";
import { InfoTip } from "@/components/ui/InfoTip";

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
        <span className="label label-with-info">Twitch login<InfoTip text="Lets this Twitch account sign in to the workspace; without a grant, sign-in is refused. Capitalisation does not matter, an existing grant is updated rather than duplicated, and only the account connected under the Twitch integration signs in as owner without one (a separately configured broadcast channel's own account still needs a grant)." /></span>
        <input name="twitchLogin" required placeholder="moderator_name" />
      </label>
      <label>
        <span className="label label-with-info">Role<InfoTip text="Decides what this person may change once signed in: viewers only look, moderators can also check in for chat coverage, operators run the playout, schedule, library, sources, shows and overlay (including the moderation and chat-game settings), and admins additionally manage destinations, the Twitch connection, the Settings pages and team access. A changed role applies at that person's next Twitch sign-in." /></span>
        <select className="select" defaultValue="moderator" name="role">
          {roles.map((role) => (
            <option key={role} value={role}>
              {humanizeOptionValue(role)}
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
