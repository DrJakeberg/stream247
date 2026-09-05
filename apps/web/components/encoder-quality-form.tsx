"use client";

import { ENCODER_SPEED_PRESETS } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

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
            <span className="label label-with-info">
              Encoder speed preset
              <InfoTip text="Sets how much processor time the encoder spends on each frame, from ultrafast to veryslow. Slower presets fit more picture quality under the bitrate ceiling but load the server harder; the same preset goes to every encoder the channel starts, live bridge included." />
            </span>
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
            <span className="label label-with-info">
              Video bitrate ceiling
              <InfoTip text="The most bandwidth the video may use, in bits per second, written like 4500k or 6M. With all three bitrate fields empty and no server values, the uplink encoder picks a ceiling from the output size while the playout and live-bridge encoders use the built-in 4500k; filling in any one of the three (or a server value for any of them) switches that automatic choice off for all three." />
            </span>
            <input
              defaultValue={props.initialValues.ffmpegMaxrate}
              name="ffmpegMaxrate"
              placeholder={`Follow the server (now: ${props.fallback.maxrate})`}
            />
          </label>
          <label>
            <span className="label label-with-info">
              Video buffer size
              <InfoTip text="Room the encoder has to spread bandwidth across neighbouring frames, so a busy moment can borrow from a quiet one, in bits like 9000k. Left empty it does not track the ceiling: with all three bitrate fields empty the uplink follows the output size (always twice its ceiling) and the other encoders use the built-in 9000k; once any bitrate field is filled, an empty buffer means the server value or 9000k." />
            </span>
            <input
              defaultValue={props.initialValues.ffmpegBufsize}
              name="ffmpegBufsize"
              placeholder={`Follow the server (now: ${props.fallback.bufsize})`}
            />
          </label>
          <label>
            <span className="label label-with-info">
              Audio bitrate
              <InfoTip text="How much bandwidth the sound gets, in bits per second like 160k, on every encoder the channel starts. Setting it counts as configuring the bitrates, so the uplink encoder stops picking its video ceiling and buffer from the output size and every encoder uses the server or built-in values for those instead." />
            </span>
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
