"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/Input";
import { TWITCH_INGEST_URL } from "@/lib/destination-wording";

type Service = "twitch" | "custom-rtmp";

/**
 * The wizard's "Where the stream goes" step (M99, U1; decided 5.1 Q9): the stream key for the built-in
 * primary destination, with the Twitch ingest as the preset. The key goes through the same route as the
 * destination form in Studio → Output, so it is stored encrypted and never comes back to the browser.
 */
export function SetupDestinationForm(props: {
  destinationId: string;
  destinationName: string;
  rtmpUrl: string;
  streamKeyPresent: boolean;
  streamKeySource: "env" | "managed" | "missing";
}) {
  const initialService: Service = !props.rtmpUrl || props.rtmpUrl === TWITCH_INGEST_URL ? "twitch" : "custom-rtmp";
  const [service, setService] = useState<Service>(initialService);
  const [rtmpUrl, setRtmpUrl] = useState(initialService === "custom-rtmp" ? props.rtmpUrl : "");
  const [streamKey, setStreamKey] = useState("");
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

        const targetUrl = service === "twitch" ? TWITCH_INGEST_URL : rtmpUrl.trim();
        if (!targetUrl) {
          setError("Enter the RTMP URL of the service.");
          return;
        }
        if (!streamKey.trim() && !props.streamKeyPresent) {
          setError("Paste the stream key.");
          return;
        }

        startTransition(async () => {
          const response = await fetch("/api/destinations", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: props.destinationId,
              provider: service,
              enabled: true,
              rtmpUrl: targetUrl,
              streamKey: streamKey.trim()
            })
          });
          const payload = (await response.json().catch(() => ({}))) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not save the destination.");
            return;
          }

          setStreamKey("");
          setMessage("Saved. The key is stored encrypted.");
          router.replace("/setup");
          router.refresh();
        });
      }}
    >
      <label>
        <span className="label">Service</span>
        <select onChange={(event) => setService(event.target.value as Service)} value={service}>
          <option value="twitch">Twitch</option>
          <option value="custom-rtmp">Another RTMP service</option>
        </select>
        {service === "twitch" ? (
          <span className="field-hint">Streams to {TWITCH_INGEST_URL}; the key decides the channel.</span>
        ) : null}
      </label>
      {service === "custom-rtmp" ? (
        <Input
          hint="The ingest address the service gives you, without the stream key."
          label="RTMP URL"
          onChange={setRtmpUrl}
          placeholder="rtmp://..."
          value={rtmpUrl}
        />
      ) : null}
      <Input
        autoComplete="new-password"
        hint={
          props.streamKeyPresent
            ? props.streamKeySource === "env"
              ? "A key is set in the server configuration. A key pasted here is used ahead of it."
              : "A key is stored. Leave blank to keep it, or paste a new one to replace it."
            : "Stored encrypted with the app secret; it never appears in this form again."
        }
        label="Stream key"
        onChange={setStreamKey}
        placeholder={props.streamKeyPresent ? "Stored — leave blank to keep" : "Paste the stream key"}
        type="password"
        value={streamKey}
      />
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : `Save to ${props.destinationName}`}
      </button>
    </form>
  );
}
