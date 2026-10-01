"use client";

import { STREAM_OUTPUT_PROFILES, normalizeStreamOutputSettings, type StreamOutputProfileId } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import type { OutputSettingsRecord } from "@/lib/server/state";

function profileDefaults(profileId: StreamOutputProfileId) {
  return normalizeStreamOutputSettings({ profileId });
}

export function OutputSettingsForm({ output }: { output: OutputSettingsRecord }) {
  const initial = normalizeStreamOutputSettings(output);
  const [profileId, setProfileId] = useState<StreamOutputProfileId>(initial.profileId);
  const [width, setWidth] = useState(String(initial.width));
  const [height, setHeight] = useState(String(initial.height));
  const [fps, setFps] = useState(String(initial.fps));
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { pushToast } = useToast();

  function selectProfile(nextProfileId: StreamOutputProfileId) {
    setProfileId(nextProfileId);
    if (nextProfileId !== "custom") {
      const preset = profileDefaults(nextProfileId);
      setWidth(String(preset.width));
      setHeight(String(preset.height));
      setFps(String(preset.fps));
    }
  }

  async function save() {
    const response = await fetch("/api/output", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        width,
        height,
        fps
      })
    });
    const payload = (await response.json()) as { message?: string };

    if (!response.ok) {
      const nextError = payload.message ?? "Could not update output settings.";
      setError(nextError);
      pushToast({
        title: "Could not save the output profile",
        description: nextError,
        tone: "error"
      });
      return;
    }

    pushToast({
      title: "Output profile saved",
      description: payload.message ?? "Output settings updated.",
      tone: "success"
    });
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(() => void save());
      }}
    >
      <label>
        <span className="label label-with-info">Output profile<InfoTip text="Sets the picture size and frame rate the channel is encoded at; the overlay is drawn at the same size. Choose Custom to type your own numbers. The bitrate ceiling is not set here: the playout encoder takes it from Encoder quality (4500k if empty), and only an uplink that re-encodes for a destination steps its ceiling by picture size while that setting is empty." /></span>
        <select onChange={(event) => selectProfile(event.target.value as StreamOutputProfileId)} value={profileId}>
          {STREAM_OUTPUT_PROFILES.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>

      <div className="form-grid">
        <label>
          <span className="label label-with-info">Width<InfoTip text="Picture width in pixels, 640 to 3840, editable only in the Custom profile. It does not change the encoder's bitrate ceiling; that is set under Encoder quality (only a re-encoding uplink with that left empty steps its ceiling by size)." /></span>
          <input
            disabled={profileId !== "custom"}
            max={3840}
            min={640}
            onChange={(event) => setWidth(event.target.value)}
            type="number"
            value={width}
          />
        </label>
        <label>
          <span className="label label-with-info">Height<InfoTip text="Picture height in pixels, 360 to 2160, editable only in the Custom profile. It does not change the encoder's bitrate ceiling; that is set under Encoder quality (only a re-encoding uplink with that left empty steps its ceiling by size, 1080 or 1920 wide reaching the top step)." /></span>
          <input
            disabled={profileId !== "custom"}
            max={2160}
            min={360}
            onChange={(event) => setHeight(event.target.value)}
            type="number"
            value={height}
          />
        </label>
        <label>
          <span className="label label-with-info">FPS<InfoTip text="Frames per second, 1 to 60, editable only in the Custom profile. The encoder and the pictures the channel generates itself, like the ticker, run at this rate." /></span>
          <input
            disabled={profileId !== "custom"}
            max={60}
            min={1}
            onChange={(event) => setFps(event.target.value)}
            type="number"
            value={fps}
          />
        </label>
      </div>

      <p className="subtle">
        A saved profile takes effect the next time playout restarts its encoder, not on the current item. If
        STREAM_OUTPUT_WIDTH, STREAM_OUTPUT_HEIGHT or STREAM_OUTPUT_FPS are set on the server, those win over what is
        chosen here.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} title="Save the current stream output profile." type="submit">
        {isPending ? "Saving..." : "Save output settings"}
      </button>
    </form>
  );
}
