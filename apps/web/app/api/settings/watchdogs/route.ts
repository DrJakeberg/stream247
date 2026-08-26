import { NextRequest, NextResponse } from "next/server";
import { WATCHDOG_LIMITS, isWithinWatchdogLimits } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateManagedConfigRecord } from "@/lib/server/state";

// The watchdog-threshold half of M56 part 2. These values decide when the channel restarts its
// own processes, so nothing is clamped silently here: a value outside the core bounds is refused
// with the reason, before anything is persisted. Partial like its siblings — only the keys the
// request carries are written.

const THRESHOLD_KEYS = [
  ["feedAudioSilenceSeconds", "silence watchdog"],
  ["feedAudioGraceSeconds", "silence watchdog's settling time"],
  ["feedStallTimeoutSeconds", "frozen-feed watchdog"],
  ["feedStallGraceSeconds", "frozen-feed watchdog's settling time"],
  ["uplinkStallTimeoutSeconds", "encoder watchdog"],
  ["uplinkStallGraceSeconds", "encoder watchdog's settling time"],
  ["uplinkNoProgressRestartSeconds", "never-started encoder restart"],
  ["durationBoundMarginSeconds", "planned end-of-video margin"]
] as const;

type WatchdogBody = Partial<Record<(typeof THRESHOLD_KEYS)[number][0], string>>;

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as WatchdogBody;
  const updates: WatchdogBody = {};

  for (const [key, label] of THRESHOLD_KEYS) {
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed !== "" && !isWithinWatchdogLimits(key, Number(trimmed))) {
      const bounds = WATCHDOG_LIMITS[key];
      return NextResponse.json(
        {
          ok: false,
          message: `The ${label} is seconds and must sit between ${String(bounds.min)} and ${String(bounds.max)} — outside that range it would either restart a healthy channel or never fire at all.`
        },
        { status: 400 }
      );
    }
    updates[key] = trimmed;
  }

  const state = await readAppState();

  await updateManagedConfigRecord({
    ...state.managedConfig,
    ...updates,
    updatedAt: new Date().toISOString()
  });

  await appendAuditEvent("settings.watchdogs.updated", "Managed watchdog thresholds were updated.");
  return NextResponse.json({ ok: true, message: "Watchdog thresholds saved." });
}
