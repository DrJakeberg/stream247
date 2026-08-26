import { NextRequest, NextResponse } from "next/server";
import {
  isValidAssetRetentionDays,
  isValidDiskWatermarkPercent,
  isValidManagedFlagText,
  resolveDiskWatermarkRecoverPercent,
  resolveDiskWatermarkTriggerPercent,
  resolveSystemVolumeRecoverPercent,
  resolveSystemVolumeTriggerPercent
} from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateManagedConfigRecord } from "@/lib/server/state";

const FLAG_KEYS = [
  "diskWatermarkEnabled",
  "assetRetentionEnabled",
  "streamChatOverlayEnabled",
  "streamAlertsEnabled",
  "twitchScheduleSyncEnabled",
  "sourceLayerEnabled"
] as const;

// Two independent percent pairs, each validated whole: the media-volume eviction watermark and
// the observation-only system-volume watermark.
const MEDIA_PERCENT_KEYS = ["diskWatermarkTriggerPercent", "diskWatermarkRecoverPercent"] as const;
const SYSTEM_PERCENT_KEYS = ["systemVolumeTriggerPercent", "systemVolumeRecoverPercent"] as const;
const PERCENT_KEYS = [...MEDIA_PERCENT_KEYS, ...SYSTEM_PERCENT_KEYS] as const;

const DAY_KEYS = ["assetRetentionProtectionDays"] as const;

type OperationsBody = Partial<
  Record<(typeof FLAG_KEYS)[number] | (typeof PERCENT_KEYS)[number] | (typeof DAY_KEYS)[number], string>
>;

// The operational switches and the disk watermark. Partial on purpose: the disk form and the
// feature-switch form save independently, so only the keys a request actually carries are
// written — a form must never blank the other form's values just because it does not know them.
export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as OperationsBody;
  const updates: OperationsBody = {};

  for (const key of FLAG_KEYS) {
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    if (!isValidManagedFlagText(value.trim())) {
      return NextResponse.json(
        { ok: false, message: "A feature switch can only be on, off, or left to follow the server environment." },
        { status: 400 }
      );
    }
    updates[key] = value.trim();
  }

  for (const key of PERCENT_KEYS) {
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed !== "" && !isValidDiskWatermarkPercent(Number(trimmed))) {
      return NextResponse.json(
        { ok: false, message: "Watermark values are percent of free disk space and must sit between 1 and 99." },
        { status: 400 }
      );
    }
    updates[key] = trimmed;
  }

  for (const key of DAY_KEYS) {
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed !== "" && !isValidAssetRetentionDays(Number(trimmed))) {
      return NextResponse.json(
        { ok: false, message: "The protection window is a whole number of days between 1 and 365." },
        { status: 400 }
      );
    }
    updates[key] = trimmed;
  }

  const state = await readAppState();
  const candidate = { ...state.managedConfig, ...updates };

  // The worker ignores a misordered pair whole; the settings page says so BEFORE anything is
  // persisted. Validated against the pair as it would actually resolve, so a half-filled form
  // is checked against what the blank half falls back to (env or default). Only enforced when
  // the request touches the managed pair — a pair misordered purely in env stays the worker's
  // silently-rejected case and must not block saving an unrelated switch.
  const touchesPair = MEDIA_PERCENT_KEYS.some((key) => updates[key] !== undefined && candidate[key] !== "");
  if (touchesPair) {
    const trigger = resolveDiskWatermarkTriggerPercent(candidate, process.env);
    const recover = resolveDiskWatermarkRecoverPercent(candidate, process.env);
    if (recover <= trigger) {
      return NextResponse.json(
        {
          ok: false,
          message: `The eviction pair was rejected whole: recovery (${String(recover)}%) must sit above the trigger (${String(trigger)}%), or the monitor would stop the moment it starts.`
        },
        { status: 400 }
      );
    }
  }

  // The observation pair follows the same whole-pair rule for the same reason: a misordered
  // pair would open and close the incident on alternating measurements.
  const touchesSystemPair = SYSTEM_PERCENT_KEYS.some((key) => updates[key] !== undefined && candidate[key] !== "");
  if (touchesSystemPair) {
    const trigger = resolveSystemVolumeTriggerPercent(candidate, process.env);
    const recover = resolveSystemVolumeRecoverPercent(candidate, process.env);
    if (recover <= trigger) {
      return NextResponse.json(
        {
          ok: false,
          message: `The system-volume pair was rejected whole: the all-clear mark (${String(recover)}%) must sit above the warning mark (${String(trigger)}%), or one incident would become a drumbeat.`
        },
        { status: 400 }
      );
    }
  }

  await updateManagedConfigRecord({
    ...candidate,
    updatedAt: new Date().toISOString()
  });

  await appendAuditEvent("settings.operations.updated", "Managed operational settings were updated.");
  return NextResponse.json({ ok: true, message: "Operational settings saved." });
}
