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

const NO_TIME_ZONES: readonly string[] = [];
let cachedTimeZones: readonly string[] | null = null;

/**
 * The zone names this browser knows, for the field's suggestion list (M122), with UTC first; empty where
 * the browser cannot list them, and then the field stays a plain text field. Read once and kept, so the
 * snapshot is the same array on every render.
 */
export function listBrowserTimeZones(): readonly string[] {
  if (cachedTimeZones) {
    return cachedTimeZones;
  }
  let zones: string[] = [];
  try {
    const supportedValuesOf = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    zones = supportedValuesOf ? supportedValuesOf("timeZone") : [];
  } catch {
    zones = [];
  }
  cachedTimeZones = zones.length > 0 ? ["UTC", ...zones.filter((zone) => zone !== "UTC")] : NO_TIME_ZONES;
  return cachedTimeZones;
}

/** A spaced label for "America/New_York", for browsers that match a typed "New York" on the label too. */
function timeZoneSearchLabel(zone: string): string | undefined {
  return zone.includes("_") ? zone.replace(/_/g, " ") : undefined;
}

const TIME_ZONE_LIST_ID = "channel-timezone-options";

export function SetupInstanceForm(props: {
  initialAppUrl: string;
  /** The origin this page was requested under, offered while nothing is saved and APP_URL is unset. */
  detectedAppUrl?: string;
  initialTimezone: string;
  initialLanguage: string;
  /** Set when env variables override the managed values; saving still works, env just wins. */
  envAppUrl: string;
  envTimezone: string;
  /** CHANNEL_TIMEZONE when it is set but not a zone this install knows: ignored, the saved zone is used. */
  envTimezoneRejected?: string;
  envLanguage: string;
  /**
   * The channel already runs on the saved zone: the basics were saved once (a stored public URL) or the
   * schedule has blocks. An empty saved zone is UTC then, not "nothing saved" (review finding R16).
   */
  zoneInUse?: boolean;
}) {
  // Prefilled rather than empty (M91, I6): the address this wizard is open under and the browser's zone
  // are right for most installs, and both say so in their hint until they are saved.
  const urlDetected = !props.initialAppUrl && !props.envAppUrl && Boolean(props.detectedAppUrl);
  const [appUrl, setAppUrl] = useState(urlDetected ? props.detectedAppUrl ?? "" : props.initialAppUrl);
  // The browser's zone is read on the client only (the server's zone is not the viewer's); until the
  // field is typed in, an unsaved and unpinned zone shows it. Only on a first run: on an install that runs
  // on UTC because its zone was left empty, the prefilled zone moved every block by an hour or two the moment
  // the operator saved the step to fix the URL (R16).
  const browserTimeZone = useSyncExternalStore(subscribeToNothing, detectBrowserTimeZone, () => "");
  const [typedTimezone, setTypedTimezone] = useState<string | null>(null);
  const zoneDetected =
    typedTimezone === null && !props.initialTimezone && !props.envTimezone && !props.zoneInUse && browserTimeZone !== "";
  const timezone = typedTimezone ?? (zoneDetected ? browserTimeZone : props.initialTimezone);
  // Client only like the browser zone: the server's ICU may list other zones than the browser's.
  const timeZones = useSyncExternalStore(subscribeToNothing, listBrowserTimeZones, () => NO_TIME_ZONES);
  // While CHANNEL_TIMEZONE pins the zone, a pick here does not decide anything, so there is no list.
  const offerZoneList = timeZones.length > 0 && !props.envTimezone;
  const searchHint = offerZoneList ? " Type a city or region to pick from the list." : "";
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
        hint={`${
          props.envTimezone
            ? `CHANNEL_TIMEZONE is set to ${props.envTimezone} in the environment and overrides whatever is saved here.`
            : props.envTimezoneRejected
              ? `CHANNEL_TIMEZONE is set to ${props.envTimezoneRejected} in the environment, which is not a time zone name this install knows, so it is ignored and the zone saved here is used (empty means UTC). ${zoneDetected ? "Prefilled with your browser's time zone; check it." : "IANA name like Europe/Berlin."}`
              : zoneDetected
                ? "Your browser's time zone; check it. IANA name like Europe/Berlin. The schedule grid and every on-air clock use it."
                : props.zoneInUse && !props.initialTimezone && typedTimezone === null
                  ? "Empty means UTC, and the channel runs on UTC now. IANA name like Europe/Berlin; another zone keeps each block's clock times, so every block moves."
                  : "IANA name like Europe/Berlin. The schedule grid and every on-air clock use it. Empty means UTC."
        }${searchHint}`}
        label="Channel timezone"
        list={offerZoneList ? TIME_ZONE_LIST_ID : undefined}
        onChange={setTypedTimezone}
        placeholder="UTC"
        value={timezone}
      />
      {offerZoneList ? (
        <datalist id={TIME_ZONE_LIST_ID}>
          {timeZones.map((zone) => (
            <option key={zone} label={timeZoneSearchLabel(zone)} value={zone} />
          ))}
        </datalist>
      ) : null}
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
