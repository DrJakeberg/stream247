"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SetupForm() {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        const formData = new FormData(event.currentTarget);
        const email = String(formData.get("email") || "");
        const password = String(formData.get("password") || "");
        const twitchClientId = String(formData.get("twitchClientId") || "");
        const twitchClientSecret = String(formData.get("twitchClientSecret") || "");

        startTransition(async () => {
          const response = await fetch("/api/setup/bootstrap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, twitchClientId, twitchClientSecret })
          });

          if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            setError(payload.message ?? "Setup failed.");
            return;
          }

          router.replace("/broadcast");
        });
      }}
    >
      <label>
        <span className="label">Owner email</span>
        <input name="email" type="email" required placeholder="owner@example.com" />
      </label>
      <label>
        <span className="label">Password</span>
        <input name="password" type="password" minLength={10} required placeholder="At least 10 characters" />
      </label>
      <p className="subtle">
        After bootstrap you will land in the dashboard, where the remaining go-live steps explain what is still missing
        for a fully broadcast-ready channel.
      </p>
      <div className="form-grid">
        <label>
          <span className="label">Optional Twitch client id</span>
          <input name="twitchClientId" placeholder="Optional during bootstrap" />
        </label>
        <label>
          <span className="label">Optional Twitch client secret</span>
          <input name="twitchClientSecret" type="password" placeholder="Optional during bootstrap" />
        </label>
      </div>
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Creating workspace..." : "Create owner account"}
      </button>
    </form>
  );
}
