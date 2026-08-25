import { NextRequest, NextResponse } from "next/server";
import { isValidEncoderBitrate, isValidEncoderSpeedPreset } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateManagedConfigRecord } from "@/lib/server/state";

// Encoder quality lives in managed config since M56 (managed value wins, FFMPEG_* env is the
// fallback). This route touches ONLY the encoder keys: the general secrets route overwrites
// every non-secret field it knows, and reusing it from a small form would wipe the fields the
// form does not carry.
export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as Partial<{
    ffmpegPreset: string;
    ffmpegMaxrate: string;
    ffmpegBufsize: string;
    ffmpegAudioBitrate: string;
  }>;

  const trim = (value: string | undefined) => (value ?? "").trim();
  const preset = trim(body.ffmpegPreset);
  const maxrate = trim(body.ffmpegMaxrate);
  const bufsize = trim(body.ffmpegBufsize);
  const audioBitrate = trim(body.ffmpegAudioBitrate);

  // Rejected rather than passed through: these values end up on an ffmpeg command line, where a
  // typo surfaces minutes later as an encoder crash-loop instead of a form error.
  if (!isValidEncoderSpeedPreset(preset)) {
    return NextResponse.json(
      { ok: false, message: "The encoder speed preset must be one of the standard presets, or empty to follow the server." },
      { status: 400 }
    );
  }

  for (const [label, value] of [
    ["video bitrate ceiling", maxrate],
    ["video buffer size", bufsize],
    ["audio bitrate", audioBitrate]
  ] as const) {
    if (!isValidEncoderBitrate(value)) {
      return NextResponse.json(
        { ok: false, message: `The ${label} must be a number of bits per second, optionally with a k or M suffix.` },
        { status: 400 }
      );
    }
  }

  const state = await readAppState();
  await updateManagedConfigRecord({
    ...state.managedConfig,
    ffmpegPreset: preset,
    ffmpegMaxrate: maxrate,
    ffmpegBufsize: bufsize,
    ffmpegAudioBitrate: audioBitrate,
    updatedAt: new Date().toISOString()
  });

  await appendAuditEvent("settings.encoder.updated", "Managed encoder quality settings were updated.");
  return NextResponse.json({ ok: true, message: "Encoder quality settings saved. They apply the next time an encoder starts." });
}
