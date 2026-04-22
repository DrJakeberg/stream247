"use client";

import { STREAM_OUTPUT_PROFILES, normalizeStreamOutputSettings, type StreamOutputProfileId } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
        <span className="label">Output profile</span>
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
          <span className="label">Width</span>
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
          <span className="label">Height</span>
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
          <span className="label">FPS</span>
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
        Saved output profiles are applied by the playout worker when it starts the next FFmpeg process. Environment
        variables named `STREAM_OUTPUT_WIDTH`, `STREAM_OUTPUT_HEIGHT`, and `STREAM_OUTPUT_FPS` still override this UI
        setting for deployment-level control.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} title="Save the current stream output profile." type="submit">
        {isPending ? "Saving..." : "Save output settings"}
      </button>
    </form>
  );
}
