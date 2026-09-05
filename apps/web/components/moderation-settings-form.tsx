"use client";

import type { ModerationConfig } from "@stream247/core";
import { InfoTip } from "@/components/ui/InfoTip";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ModerationSettingsForm({ config }: { config: ModerationConfig }) {
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
        const payload = {
          enabled: formData.get("enabled") === "on",
          command: String(formData.get("command") || "here"),
          defaultMinutes: Number(formData.get("defaultMinutes") || 30),
          minMinutes: Number(formData.get("minMinutes") || 5),
          maxMinutes: Number(formData.get("maxMinutes") || 240),
          requirePrefix: formData.get("requirePrefix") === "on",
          fallbackEmoteOnly: formData.get("fallbackEmoteOnly") === "on"
        };

        startTransition(async () => {
          const response = await fetch("/api/moderation/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          const body = (await response.json()) as { message?: string };

          if (!response.ok) {
            setError(body.message ?? "Could not save settings.");
            return;
          }

          setMessage(body.message ?? "Saved.");
          router.refresh();
        });
      }}
    >
      <label className="toggle-row">
        <input defaultChecked={config.enabled} name="enabled" type="checkbox" />
        <span className="label-with-info">Enable moderation presence policy<InfoTip text="While on, moderators can check in from chat and the channel sets Twitch's emote-only mode from their coverage. While off, check-ins are ignored and the chat mode on Twitch is left exactly as it is." /></span>
      </label>
      <label>
        <span className="label label-with-info">Command keyword<InfoTip text="The word moderators send in chat to check in, entered here without the &quot;!&quot; — with the default &quot;here&quot;, a moderator types &quot;!here&quot; or &quot;!here 30&quot; for a thirty-minute window. Only messages from moderators or the broadcaster count, the message must be the command alone, and letter case is ignored." /></span>
        <input defaultValue={config.command} name="command" required />
      </label>
      <label className="toggle-row">
        <input defaultChecked={config.requirePrefix} name="requirePrefix" type="checkbox" />
        <span className="label-with-info">Require command prefix<InfoTip text="Only a message beginning with &quot;!&quot; counts as a check-in, so a moderator sending just the bare word (&quot;here&quot;) does not open a coverage window. Off, &quot;here&quot; and &quot;!here&quot; both count; either way the message must be the command alone, so the word inside a sentence never counts." /></span>
      </label>
      <div className="form-grid">
        <label>
          <span className="label label-with-info">Default minutes<InfoTip text="How long a check-in covers when the moderator gives no number. Must sit between the minimum and the maximum; the reply in chat tells the moderator which length was applied." /></span>
          <input defaultValue={config.defaultMinutes} min={1} name="defaultMinutes" type="number" />
        </label>
        <label>
          <span className="label label-with-info">Minimum minutes<InfoTip text="The shortest coverage window a check-in can open. A moderator who asks for less gets this length instead and is told so in chat." /></span>
          <input defaultValue={config.minMinutes} min={1} name="minMinutes" type="number" />
        </label>
        <label>
          <span className="label label-with-info">Maximum minutes<InfoTip text="The longest coverage window one check-in can open. A request above it is cut down to this length, and the moderator is told so in chat." /></span>
          <input defaultValue={config.maxMinutes} min={1} name="maxMinutes" type="number" />
        </label>
      </div>
      <p className="subtle">
        Omitted durations use the default. Requests below the minimum clamp up, and requests above the maximum clamp down.
      </p>
      <label className="toggle-row">
        <input defaultChecked={config.fallbackEmoteOnly} name="fallbackEmoteOnly" type="checkbox" />
        <span className="label-with-info">Fallback to emote-only when no moderation presence is active<InfoTip text="Switches Twitch chat into emote-only mode while no moderator's coverage window is active, and back to normal once one checks in — each change lands on the worker's next pass, within about half a minute. Off, chat is set to normal mode whether or not a moderator is present." /></span>
      </label>
      {message ? <p>{message}</p> : null}
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save moderation policy"}
      </button>
    </form>
  );
}
