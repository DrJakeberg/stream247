import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What the channel actually shows, guarded one level above the helper.
 *
 * The operator's report was "I am not seeing the overlay that is in the stream": the studio preview
 * drew the scene while the broadcast ran the old drawtext overlay -- no scene, no custom layers, no
 * chat, no game, no ticker, no clock -- for the entire length of a programme, hours for a VOD.
 *
 * The cause was upstream of every unit under test. `startPlayoutProcess` skipped the initial scene
 * frame whenever the previous ffmpeg process had exited recently, and a programme that simply ends
 * looks exactly like that: ffmpeg leaves with code 0, the exit path writes status "idle" and
 * lastExitCode String(0) -- the truthy string "0" -- plus a heartbeat stamped at that moment, then
 * asks for the next cycle. So `ensureScenePayload` and `prepareSceneRendererFrame` were both
 * skipped, initialSceneFrame stayed null, and the mode fell to "text" for the whole run. Because
 * lastExitCode is never cleared on a successful start, it stayed that way from the second process
 * onward. There was no incident either, since the fallback incident lives inside
 * prepareSceneRendererFrame -- exactly the call that was skipped -- leaving one log line as the
 * only trace.
 *
 * The overlay mode is baked into the ffmpeg command (a PNG pipe composited with `overlay` versus a
 * `drawtext` filter) and cannot be changed while the process runs, so this decision gets one chance
 * per programme. These assertions read the source because apps/worker/src/index.ts starts a worker
 * on import; that is the same approach relay-presence and incident-classes already take.
 */

const workerSource = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");

describe("on-air overlay mode wiring", () => {
  it("decides the overlay mode only from the overlay switch and whether a frame rendered", () => {
    expect(workerSource).toContain("const overlayMode: OnAirOverlayMode = resolveOnAirOverlayMode({");
    expect(workerSource).toContain("sceneFrameRendered: Boolean(initialSceneFrame)");
  });

  it("renders the first frame on every start, with no recovery skip in the way", () => {
    // Both calls are guarded by the overlay switch and nothing else. A second condition here is
    // what produced the fault, so the guard is the exact text.
    expect(workerSource).toContain("if (args.overlayEnabled) {\n    await ensureScenePayload(args.asset ?? null);\n  }");
    expect(workerSource).toContain(
      "const initialSceneFrame = args.overlayEnabled ? await prepareSceneRendererFrame(outputSettings) : null;"
    );
  });

  it("keeps the retired recovery skip from coming back", () => {
    // The helper, its window, its log line, and the three runtime fields that fed it. Any of them
    // reappearing means the exit code is deciding the overlay again.
    expect(workerSource).not.toContain("shouldSkipInitialSceneCapture");
    expect(workerSource).not.toContain("PLAYOUT_RECOVERY_SCENE_CAPTURE_SKIP_WINDOW_MS");
    expect(workerSource).not.toContain("scene.render.recovery.skip");
    expect(workerSource).not.toContain("runtimeLastExitCode");
    expect(workerSource).not.toContain("runtimeHeartbeatAt");
  });

  it("bounds the first frame so a stalled renderer cannot hold the programme off air", () => {
    // The only thing the old skip was reaching for, aimed at the hazard itself rather than at an
    // unrelated exit code. Measured worst case for a real frame is ~201ms, so the bound has room.
    expect(workerSource).toContain("const SCENE_FIRST_FRAME_TIMEOUT_MS = 5_000;");
    expect(workerSource).toContain("captureRenderedSceneFrame(outputSettings),");
    expect(workerSource).toMatch(/Promise\.race\(\[/);
  });

  it("still raises the fallback incident, and says the whole programme is affected", () => {
    // A missing frame cannot be repaired mid-programme: the mode is fixed for the life of the
    // ffmpeg process. Since the picture stays wrong until the next boundary, the incident has to
    // be the thing that says so.
    expect(workerSource).toContain('fingerprint: "playout.scene-render.failed"');
    expect(workerSource).toContain("The programme now on air will run to its end in text mode");
  });
});
