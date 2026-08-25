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

        startTransition(async () => {
          const response = await fetch("/api/setup/bootstrap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
          });

          if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            setError(payload.message ?? "Setup failed.");
            return;
          }

          // Stay in the wizard: the next step is derived server-side from what is configured, so a
          // plain revisit of /setup continues exactly where this bootstrap left off.
          router.replace("/setup");
          router.refresh();
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
        This account owns the workspace and signs in with email and password. Everything else — the public URL, Twitch
        credentials, the Twitch connection — has its own later step, and each one can be done now or skipped and picked
        up again.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Creating workspace..." : "Create owner account"}
      </button>
    </form>
  );
}
