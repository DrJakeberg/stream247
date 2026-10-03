"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { CHANNEL_LANGUAGE_INFO, CHANNEL_LANGUAGE_OPTIONS } from "@/components/channel-language-form";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

/** The browser's IANA zone, or "" where the browser does not say (M91, I6). */
export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

// The browser's zone does not change under a mounted form, so there is nothing to subscribe to.
const subscribeToNothing = () => () => undefined;

export function SetupInstanceForm(props: {
  initialAppUrl: string;
  /** The origin this page was requested under, offered while nothing is saved and APP_URL is unset. */
  detectedAppUrl?: string;
  initialTimezone: string;
  initialLanguage: string;
  /** Set when env variables override the managed values; saving still works, env just wins. */
  envAppUrl: string;
  envTimezone: string;
  envLanguage: string;
}) {
  // Prefilled rather than empty (M91, I6): the address this wizard is open under and the browser's zone
  // are right for most installs, and both say so in their hint until they are saved.
  const urlDetected = !props.initialAppUrl && !props.envAppUrl && Boolean(props.detectedAppUrl);
  const [appUrl, setAppUrl] = useState(urlDetected ? props.detectedAppUrl ?? "" : props.initialAppUrl);
  // The browser's zone is read on the client only (the server's zone is not the viewer's); until the
  // field is typed in, an unsaved and unpinned zone shows it.
  const browserTimeZone = useSyncExternalStore(subscribeToNothing, detectBrowserTimeZone, () => "");
  const [typedTimezone, setTypedTimezone] = useState<string | null>(null);
  const zoneDetected = typedTimezone === null && !props.initialTimezone && !props.envTimezone && browserTimeZone !== "";
  const timezone = typedTimezone ?? (zoneDetected ? browserTimeZone : props.initialTimezone);
  // New installs speak English to viewers; an empty stored value is English too.
  const [language, setLanguage] = useState(props.initialLanguage || "en");
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
            body: JSON.stringify({ appUrl, channelTimezone: timezone, channelLanguage: language })
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
            : urlDetected
              ? "Detected from the address this page is open under; check it. It must be the address viewers and OAuth callbacks reach this install under, e.g. https://stream.example.com."
              : "The address viewers and OAuth callbacks reach this install under, e.g. https://stream.example.com."
        }
        label="Public app URL"
        onChange={setAppUrl}
        placeholder="https://stream.example.com"
        // Saving an empty URL used to succeed silently and land on the same step; the wizard then printed
        // localhost redirect URLs for Twitch. Required unless the environment pins the URL anyway.
        required={!props.envAppUrl}
        type="url"
        value={appUrl}
      />
      <Input
        hint={
          props.envTimezone
            ? `CHANNEL_TIMEZONE is set to ${props.envTimezone} in the environment and overrides whatever is saved here.`
            : zoneDetected
              ? "Your browser's time zone; check it. IANA name like Europe/Berlin. The schedule grid and every on-air clock use it."
              : "IANA name like Europe/Berlin. The schedule grid and every on-air clock use it. Empty means UTC."
        }
        label="Channel timezone"
        onChange={setTypedTimezone}
        placeholder="UTC"
        value={timezone}
      />
      <Select
        hint={
          props.envLanguage
            ? `CHANNEL_LANGUAGE is set to ${props.envLanguage} in the environment and overrides whatever is saved here.`
            : undefined
        }
        info={CHANNEL_LANGUAGE_INFO}
        label="Channel language"
        onChange={setLanguage}
        options={CHANNEL_LANGUAGE_OPTIONS}
        value={language}
      />
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save instance basics"}
      </button>
    </form>
  );
}
