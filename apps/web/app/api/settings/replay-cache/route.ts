import { NextRequest, NextResponse } from "next/server";
import {
  isValidManagedFlagText,
  isValidVodCacheGb,
  isValidVodCacheLimitRate,
  resolveVodCacheTuning,
  VOD_CACHE_LIMITS
} from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateManagedConfigRecord } from "@/lib/server/state";

// The replay-cache half of M56 part 2. Partial on purpose, like every managed-settings route:
// only the keys a request carries are written, so the folded forms can never blank each other.

const FLAG_KEYS = ["vodCacheEnabled", "vodCacheAllowRemoteFallback"] as const;

const GB_KEYS = ["vodCacheMaxGb", "vodCacheMinFreeGb", "vodCacheMaxAssetGb"] as const;

// Each duration key validates against the same core bounds the resolver clamps to, so the API
// refuses exactly what the worker would have corrected.
const BOUNDED_KEYS = [
  ["vodCacheRetentionHours", VOD_CACHE_LIMITS.retentionHours, "hours to keep a cached replay"],
  ["vodCachePartialMaxAgeHours", VOD_CACHE_LIMITS.partialMaxAgeHours, "hours to keep an unfinished download"],
  ["vodCacheDownloadTimeoutSeconds", VOD_CACHE_LIMITS.downloadTimeoutSeconds, "seconds before a download is abandoned"],
  ["vodCacheFailureCooldownSeconds", VOD_CACHE_LIMITS.failureCooldownSeconds, "seconds before a failed replay is retried"]
] as const;

type ReplayCacheBody = Partial<
  Record<(typeof FLAG_KEYS)[number] | (typeof GB_KEYS)[number] | (typeof BOUNDED_KEYS)[number][0] | "vodCacheLimitRate", string>
>;

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as ReplayCacheBody;
  const updates: ReplayCacheBody = {};

  for (const key of FLAG_KEYS) {
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    if (!isValidManagedFlagText(value.trim())) {
      return NextResponse.json(
        { ok: false, message: "A cache switch can only be on, off, or left to follow the server environment." },
        { status: 400 }
      );
    }
    updates[key] = value.trim();
  }

  for (const key of GB_KEYS) {
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed !== "" && !isValidVodCacheGb(Number(trimmed))) {
      return NextResponse.json(
        {
          ok: false,
          message: `Cache sizes are GB and must sit between ${String(VOD_CACHE_LIMITS.gb.min)} and ${String(VOD_CACHE_LIMITS.gb.max)}.`
        },
        { status: 400 }
      );
    }
    updates[key] = trimmed;
  }

  for (const [key, bounds, label] of BOUNDED_KEYS) {
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    if (trimmed !== "" && !(Number.isFinite(parsed) && parsed >= bounds.min && parsed <= bounds.max)) {
      return NextResponse.json(
        { ok: false, message: `The ${label} must sit between ${String(bounds.min)} and ${String(bounds.max)}.` },
        { status: 400 }
      );
    }
    updates[key] = trimmed;
  }

  if (body.vodCacheLimitRate !== undefined) {
    const trimmed = body.vodCacheLimitRate.trim();
    if (!isValidVodCacheLimitRate(trimmed)) {
      return NextResponse.json(
        {
          ok: false,
          message: "The download speed ceiling is a number with an optional K, M or G suffix (for example 8M), or 0 for unlimited."
        },
        { status: 400 }
      );
    }
    updates.vodCacheLimitRate = trimmed;
  }

  const state = await readAppState();
  const candidate = { ...state.managedConfig, ...updates };

  // A per-replay ceiling above the whole cache is refused whole, checked against the pair as it
  // would actually resolve: downloading something the cache cannot hold saturates the line for as
  // long as it runs, is then evicted, and the next attempt starts over. Only enforced when the
  // request touches the managed pair — an env-only misordering stays the worker's documented case
  // and must not block saving an unrelated switch.
  const touchesSizePair = (["vodCacheMaxGb", "vodCacheMaxAssetGb"] as const).some(
    (key) => updates[key] !== undefined && candidate[key] !== ""
  );
  if (touchesSizePair) {
    const tuning = resolveVodCacheTuning(candidate, process.env);
    if (tuning.maxAssetBytes > tuning.maxCacheBytes) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "The largest single replay must fit inside the cache ceiling, or it would be downloaded, evicted, and downloaded again forever. The pair is rejected whole."
        },
        { status: 400 }
      );
    }
  }

  await updateManagedConfigRecord({
    ...candidate,
    updatedAt: new Date().toISOString()
  });

  await appendAuditEvent("settings.replay_cache.updated", "Managed replay cache settings were updated.");
  return NextResponse.json({ ok: true, message: "Replay cache settings saved." });
}
