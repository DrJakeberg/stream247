import { NextRequest, NextResponse } from "next/server";
import { FEED_TUNING_LIMITS, isWithinFeedTuningLimits } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateManagedConfigRecord } from "@/lib/server/state";

// The feed-tuning half of M56 part 2: the planned encoder reconnect cadence and the program
// feed's segment geometry. Whole numbers only — these become process arguments and schedule
// arithmetic, and "12.5 segments" is not a thing the muxer can be asked for. Partial like its
// siblings — only the keys the request carries are written.

const TUNING_KEYS = [
  ["playoutReconnectHours", "hours between planned reconnects"],
  ["playoutReconnectWindowSeconds", "seconds the reconnect pause lasts"],
  ["programFeedTargetSeconds", "seconds per feed segment"],
  ["programFeedListSize", "segments the feed window holds"],
  ["programFeedFailoverSeconds", "seconds before an aging feed counts as stopped"]
] as const;

type FeedTuningBody = Partial<Record<(typeof TUNING_KEYS)[number][0], string>>;

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as FeedTuningBody;
  const updates: FeedTuningBody = {};

  for (const [key, label] of TUNING_KEYS) {
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    if (trimmed !== "" && !(Number.isInteger(parsed) && isWithinFeedTuningLimits(key, parsed))) {
      const bounds = FEED_TUNING_LIMITS[key];
      return NextResponse.json(
        {
          ok: false,
          message: `The ${label} must be a whole number between ${String(bounds.min)} and ${String(bounds.max)}.`
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

  await appendAuditEvent("settings.feed_tuning.updated", "Managed feed tuning was updated.");
  return NextResponse.json({ ok: true, message: "Feed tuning saved." });
}
