export const dynamic = "force-dynamic";

import { resolveStreamOutputSettings } from "@stream247/core";
import { AdminPageHeader } from "@/components/admin-page-header";
import { OutputSettingsForm } from "@/components/output-settings-form";
import { Panel } from "@/components/panel";
import { readAppState } from "@/lib/server/state";

export default async function OutputPage() {
  const state = await readAppState();
  const effectiveOutput = resolveStreamOutputSettings({ settings: state.output, env: process.env });
  const envOverrideActive =
    process.env.STREAM_OUTPUT_WIDTH !== undefined ||
    process.env.STREAM_OUTPUT_HEIGHT !== undefined ||
    process.env.STREAM_OUTPUT_FPS !== undefined;

  return (
    <div className="stack-form">
      <AdminPageHeader
        description="Control the channel frame size and FPS used by standby, on-air scene rendering, and FFmpeg output normalization."
        eyebrow="Output"
        title="Set the stream resolution and frame rate."
      />

      <div className="grid two">
        <Panel title="Output profile" eyebrow="Stream settings">
          <OutputSettingsForm output={state.output} />
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
          </div>
        </Panel>
      </div>
    </div>
  );
}
