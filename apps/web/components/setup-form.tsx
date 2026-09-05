"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

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
        <span className="label label-with-info">Owner email<InfoTip text="Becomes the permanent sign-in address of the workspace owner; the app has no way to change it afterwards, so pick an address you will keep. You are signed in with it the moment the account is created." /></span>
        <input name="email" type="email" required placeholder="owner@example.com" />
      </label>
      <label>
        <span className="label label-with-info">Password<InfoTip text="At least 10 characters, and there is no place in the app to change it afterwards, so store it somewhere safe. A one-time code from an authenticator app can be added later under Settings." /></span>
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
