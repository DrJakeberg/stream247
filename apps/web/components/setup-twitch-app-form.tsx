"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/Input";

export function SetupTwitchAppForm(props: {
  initialClientId: string;
  hasStoredClientSecret: boolean;
}) {
  const [clientId, setClientId] = useState(props.initialClientId);
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        startTransition(async () => {
          const response = await fetch("/api/settings/twitch-app", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ twitchClientId: clientId, twitchClientSecret: clientSecret })
          });

          if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            setError(payload.message ?? "Could not save Twitch app credentials.");
            return;
          }

          router.replace("/setup");
          router.refresh();
        });
      }}
    >
      <Input
        hint="From the application you registered in the Twitch developer console."
        label="Twitch client id"
        onChange={setClientId}
        placeholder="Client id"
        value={clientId}
      />
      <Input
        hint={
          props.hasStoredClientSecret
            ? "A secret is stored encrypted. Leave blank to keep it, or paste a new one to replace it."
            : "Stored encrypted with the app secret; it never appears in this form again."
        }
        label="Twitch client secret"
        onChange={setClientSecret}
        placeholder={props.hasStoredClientSecret ? "Stored — leave blank to keep" : "Client secret"}
        type="password"
        value={clientSecret}
      />
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save Twitch app credentials"}
      </button>
    </form>
  );
}
