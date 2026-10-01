"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { VIEWER_LOCALE_LABELS, VIEWER_LOCALES } from "@stream247/core";
import { Select } from "@/components/ui/Select";

/**
 * The language viewers are addressed in (M80), on the settings page.
 *
 * The setup wizard asks for it once; this is where an owner changes it afterwards without walking
 * the wizard again. It saves only this field — the instance route keeps every field a request does
 * not carry — so the public URL and the timezone are untouched.
 */
export const CHANNEL_LANGUAGE_OPTIONS = VIEWER_LOCALES.map((locale) => ({ value: locale, label: VIEWER_LOCALE_LABELS[locale] }));

export const CHANNEL_LANGUAGE_INFO =
  "Applies to everything viewers see or read: the on-air picture, the standby and reconnect slates, polls and the skip bar, chat games, every chat bot reply and the public channel page. Your own titles and scene texts stay exactly as you wrote them. The admin interface stays English.";

export function ChannelLanguageForm(props: {
  initialLanguage: string;
  /** Set when CHANNEL_LANGUAGE pins the language; saving still works, the environment just wins. */
  envLanguage: string;
}) {
  const [language, setLanguage] = useState(props.initialLanguage || "en");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");

        startTransition(async () => {
          const response = await fetch("/api/settings/instance", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelLanguage: language })
          });
          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not save the channel language.");
            return;
          }
          setMessage("Channel language saved.");
          router.refresh();
        });
      }}
    >
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
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button button-secondary" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save channel language"}
      </button>
    </form>
  );
}
