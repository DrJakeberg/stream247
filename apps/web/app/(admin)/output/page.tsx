export const dynamic = "force-dynamic";

import {
  resolveDestinationOutputSettings,
  resolveEncoderQualitySettings,
  resolveStreamOutputSettings
} from "@stream247/core";
import { AdminPageHeader } from "@/components/admin-page-header";
import { DestinationOutputProfileForm } from "@/components/destination-output-profile-form";
import { EncoderQualityForm } from "@/components/encoder-quality-form";
import { OutputSettingsForm } from "@/components/output-settings-form";
import { Panel } from "@/components/panel";
import { readAppState } from "@/lib/server/state";

export default async function OutputPage() {
  const state = await readAppState();
  const effectiveOutput = resolveStreamOutputSettings({ settings: state.output, env: process.env });
  // The env-only resolution: what an empty managed field falls back to, shown as "Follow the
  // server (now: ...)" in the encoder group.
  const encoderFallback = resolveEncoderQualitySettings(null, process.env);
  const envOverrideActive =
    process.env.STREAM_OUTPUT_WIDTH !== undefined ||
    process.env.STREAM_OUTPUT_HEIGHT !== undefined ||
    process.env.STREAM_OUTPUT_FPS !== undefined;
  const effectiveOutputLabel = `${effectiveOutput.width}x${effectiveOutput.height}@${effectiveOutput.fps}`;
  const orderedDestinations = [...state.destinations].sort(
    (left, right) => left.priority - right.priority || left.name.localeCompare(right.name)
  );

  return (
    <div className="stack-form">
      <AdminPageHeader
        description="Control the stream output profile, per-destination overrides, and the destination health states that feed the live delivery path."
        eyebrow="Output"
        title="Set the stream output profile and destination overrides."
      />

      <div className="grid two">
        <Panel title="Output profile" eyebrow="Stream settings">
          <OutputSettingsForm output={state.output} />
          <EncoderQualityForm
            initialValues={{
              ffmpegPreset: state.managedConfig.ffmpegPreset,
              ffmpegMaxrate: state.managedConfig.ffmpegMaxrate,
              ffmpegBufsize: state.managedConfig.ffmpegBufsize,
              ffmpegAudioBitrate: state.managedConfig.ffmpegAudioBitrate
            }}
            fallback={{
              preset: encoderFallback.preset,
              maxrate: encoderFallback.maxrate,
              bufsize: encoderFallback.bufsize,
              audioBitrate: encoderFallback.audioBitrate
            }}
          />
        </Panel>

        <Panel title="Effective runtime output" eyebrow="Runtime">
          <div className="list">
            <div className="item">
              <strong>
                {effectiveOutput.width}x{effectiveOutput.height}@{effectiveOutput.fps}
              </strong>
              <div className="subtle">
                {envOverrideActive
                  ? "Deployment environment variables are overriding the saved output profile."
                  : "The saved output profile is the effective runtime output."}
              </div>
            </div>
            <div className="item">
              <strong>Overlay capture</strong>
              <div className="subtle">
                Scene rendering follows the output dimensions unless `SCENE_RENDER_WIDTH` or `SCENE_RENDER_HEIGHT`
                are explicitly set.
              </div>
            </div>
            <div className="item">
              <strong>Scaling rollback</strong>
              <div className="subtle">
                Set `STREAM_SCALE_ENABLED=0` only as a temporary rollback if output normalization causes unexpected
                encoder load.
              </div>
            </div>
            <div className="item">
              <strong>Parallel renditions</strong>
              <div className="subtle">
                Destinations can inherit the stream profile or pin a lower fixed profile. Rendering above the stream
                profile upscales the shared program feed and increases CPU cost.
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Per-destination renditions" eyebrow="Delivery">
        <div className="list">
          {orderedDestinations.map((destination) => {
            const effectiveDestinationOutput = resolveDestinationOutputSettings({
              destinationProfileId: destination.outputProfileId,
              streamSettings: state.output,
              env: process.env
            });
            const effectiveDestinationLabel = `${effectiveDestinationOutput.width}x${effectiveDestinationOutput.height}@${effectiveDestinationOutput.fps}`;
            return (
              <div className="item" key={destination.id}>
                <strong>{destination.name}</strong>
                <div className="subtle">
                  {destination.role} · priority {destination.priority} · {destination.rtmpUrl || "No RTMP URL configured"}
                </div>
                <div className="subtle">
                  Assigned profile {destination.outputProfileId ?? "inherit"} · effective {effectiveDestinationLabel}
                </div>
                <DestinationOutputProfileForm
                  destination={destination}
                  effectiveLabel={effectiveDestinationLabel}
                  streamProfileLabel={effectiveOutputLabel}
                />
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
