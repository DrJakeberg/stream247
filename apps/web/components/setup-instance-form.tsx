"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/Input";

export function SetupInstanceForm(props: {
  initialAppUrl: string;
  initialTimezone: string;
  /** Set when env variables override the managed values; saving still works, env just wins. */
  envAppUrl: string;
  envTimezone: string;
}) {
  const [appUrl, setAppUrl] = useState(props.initialAppUrl);
  const [timezone, setTimezone] = useState(props.initialTimezone);
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
          const response = await fetch("/api/settings/instance", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appUrl, channelTimezone: timezone })
          });

          if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            setError(payload.message ?? "Could not save instance basics.");
            return;
          }

          // Back to the wizard spine, which re-derives the next open step from the saved state.
          router.replace("/setup");
          router.refresh();
        });
      }}
    >
      <Input
        hint={
          props.envAppUrl
            ? `APP_URL is set to ${props.envAppUrl} in the environment and overrides whatever is saved here.`
            : "The address viewers and OAuth callbacks reach this install under, e.g. https://stream.example.com."
        }
        label="Public app URL"
        onChange={setAppUrl}
        placeholder="https://stream.example.com"
        value={appUrl}
      />
      <Input
        hint={
          props.envTimezone
            ? `CHANNEL_TIMEZONE is set to ${props.envTimezone} in the environment and overrides whatever is saved here.`
            : "IANA name like Europe/Berlin. The schedule grid and every on-air clock use it. Empty means UTC."
        }
        label="Channel timezone"
        onChange={setTimezone}
        placeholder="UTC"
        value={timezone}
      />
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save instance basics"}
      </button>
    </form>
  );
}
