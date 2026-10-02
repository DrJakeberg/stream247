// Instance-level configuration that the setup wizard can write.
//
// APP_URL and the channel timezone used to be env-only. Since M52 they also live in managed
// config, and every reader goes through these resolvers. Precedence is env first: the M52 rollback
// contract is that env variables keep overriding wizard-written values, so an install that manages
// its .env by hand behaves exactly as before. (Note this is the opposite order from the Twitch
// credential fields, where the managed value wins and env is only the fallback — those predate the
// wizard and their contract is "settings page beats stale env".) The channel language (M80) was
// born managed and follows the timezone's order, so the two instance basics behave alike.

import { normalizeViewerLocale, type ViewerLocale } from "@stream247/core";
import type { ManagedConfigRecord } from "./index.js";

type EnvLike = Record<string, string | undefined>;

/**
 * The public base URL of this install, without a trailing slash — or "" when nobody configured
 * one. Callers that want a URL regardless (dev convenience) add their own localhost default; the
 * onboarding checklist and the wizard need to see the difference between configured and defaulted.
 */
export function resolveAppBaseUrl(
  managedConfig: Partial<Pick<ManagedConfigRecord, "appUrl">> | undefined,
  env: EnvLike = process.env
): string {
  const configured = (env.APP_URL || "").trim() || (managedConfig?.appUrl || "").trim();
  return configured.replace(/\/+$/, "");
}

/**
 * The channel's IANA timezone: env override, then the wizard-written value, then UTC.
 *
 * A value Intl does not accept is skipped rather than returned (M85). The wizard validates what it
 * writes, but the env value never passed through it, and a typo such as `Europe/Berln` used to throw
 * in every schedule read -- inside every playout cycle and on every schedule-showing page. The
 * worker raises a state incident for the skipped value (`findChannelTimeZoneProblem`), so the
 * fallback is visible and not silent.
 */
export function resolveChannelTimeZone(
  managedConfig: Partial<Pick<ManagedConfigRecord, "channelTimezone">> | undefined,
  env: EnvLike = process.env
): string {
  const fromEnv = (env.CHANNEL_TIMEZONE || "").trim();
  if (fromEnv && isUsableTimeZone(fromEnv)) {
    return fromEnv;
  }
  const managed = (managedConfig?.channelTimezone || "").trim();
  if (managed && isUsableTimeZone(managed)) {
    return managed;
  }
  return "UTC";
}

/**
 * Why `resolveChannelTimeZone` had to skip a configured value, or null when nothing was skipped.
 * The message names the bad value, where it came from, and the zone the channel runs on instead.
 */
export function findChannelTimeZoneProblem(
  managedConfig: Partial<Pick<ManagedConfigRecord, "channelTimezone">> | undefined,
  env: EnvLike = process.env
): string | null {
  const fromEnv = (env.CHANNEL_TIMEZONE || "").trim();
  const managed = (managedConfig?.channelTimezone || "").trim();
  const rejected: string[] = [];
  if (fromEnv && !isUsableTimeZone(fromEnv)) {
    rejected.push(`CHANNEL_TIMEZONE="${fromEnv}" in the environment`);
  }
  // A bad managed value only matters when no usable env value overrides it.
  if (!(fromEnv && isUsableTimeZone(fromEnv)) && managed && !isUsableTimeZone(managed)) {
    rejected.push(`the saved channel timezone "${managed}"`);
  }
  if (rejected.length === 0) {
    return null;
  }
  const used = resolveChannelTimeZone(managedConfig, env);
  return `${rejected.join(" and ")} ${rejected.length > 1 ? "are not valid timezones" : "is not a valid timezone"}, so the schedule runs on ${used}. Use an IANA zone name such as Europe/Berlin.`;
}

/**
 * The language viewers are addressed in (M80): env override, then the wizard-written value, then
 * English — the timezone's order, for the same rollback reason. Anything that is not a language
 * this build speaks is English rather than an error: the value is read inside the renderer and the
 * chat bot, where a throw costs the picture or the bot.
 */
export function resolveChannelLanguage(
  managedConfig: Partial<Pick<ManagedConfigRecord, "channelLanguage">> | undefined,
  env: EnvLike = process.env
): ViewerLocale {
  return normalizeViewerLocale((env.CHANNEL_LANGUAGE || "").trim() || (managedConfig?.channelLanguage || "").trim());
}

const usableTimeZoneCache = new Map<string, boolean>();

/**
 * Whether Intl accepts the value as a timezone. The wizard validates before persisting, because a
 * bad timezone would otherwise throw much later, deep inside schedule materialisation.
 */
export function isUsableTimeZone(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  // Cached, because resolveChannelTimeZone asks on every schedule read and the answer for a given
  // string never changes within one process. Bounded: only configured values reach it.
  const known = usableTimeZoneCache.get(value);
  if (known !== undefined) {
    return known;
  }
  let usable: boolean;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    usable = true;
  } catch {
    usable = false;
  }
  if (usableTimeZoneCache.size >= 64) {
    usableTimeZoneCache.clear();
  }
  usableTimeZoneCache.set(value, usable);
  return usable;
}

