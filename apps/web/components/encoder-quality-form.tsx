"use client";

import { ENCODER_SPEED_PRESETS } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Folded by default: these four values are a "touch once, verify on air" decision, not part of
// the everyday output workflow — and the closed group keeps the studio-output control budget
// where it is. Empty always means "follow the server environment or the built-in default".
export function EncoderQualityForm(props: {
  initialValues: {
    ffmpegPreset: string;
    ffmpegMaxrate: string;
    ffmpegBufsize: string;
    ffmpegAudioBitrate: string;
  };
  /** What an empty field resolves to: the env variable or the built-in default. */
  fallback: {
    preset: string;
    maxrate: string;
    bufsize: string;
    audioBitrate: string;
  };
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <details className="disclosure">
      <summary>Encoder quality</summary>
      <form
        className="stack-form"
        style={{ marginTop: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setMessage("");
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            const response = await fetch("/api/settings/encoder", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ffmpegPreset: String(formData.get("ffmpegPreset") || ""),
                ffmpegMaxrate: String(formData.get("ffmpegMaxrate") || ""),
                ffmpegBufsize: String(formData.get("ffmpegBufsize") || ""),
                ffmpegAudioBitrate: String(formData.get("ffmpegAudioBitrate") || "")
              })
            });
            const payload = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(payload.message ?? "Could not save the encoder quality settings.");
              return;
            }
            setMessage(payload.message ?? "Encoder quality settings saved.");
            router.refresh();
          });
        }}
      >
        <p className="subtle">
          How hard the encoder works and how much bandwidth it may use. Empty fields follow the server
          environment or the built-in default; changes apply the next time an encoder starts.
        </p>
        <div className="form-grid">
          <label>
            <span className="label">Encoder speed preset</span>
            <select defaultValue={props.initialValues.ffmpegPreset} name="ffmpegPreset">
              <option value="">Follow the server (now: {props.fallback.preset})</option>
              {ENCODER_SPEED_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Video bitrate ceiling</span>
            <input
              defaultValue={props.initialValues.ffmpegMaxrate}
              name="ffmpegMaxrate"
              placeholder={`Follow the server (now: ${props.fallback.maxrate})`}
            />
          </label>
          <label>
            <span className="label">Video buffer size</span>
            <input
              defaultValue={props.initialValues.ffmpegBufsize}
              name="ffmpegBufsize"
              placeholder={`Follow the server (now: ${props.fallback.bufsize})`}
            />
          </label>
          <label>
            <span className="label">Audio bitrate</span>
            <input
              defaultValue={props.initialValues.ffmpegAudioBitrate}
              name="ffmpegAudioBitrate"
              placeholder={`Follow the server (now: ${props.fallback.audioBitrate})`}
            />
          </label>
        </div>
        {error ? <p className="danger">{error}</p> : null}
        {message ? <p className="subtle">{message}</p> : null}
        <button className="button button-secondary" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save encoder quality"}
        </button>
      </form>
    </details>
  );
}
