/**
 * Secrets have a habit of arriving inside text: ffmpeg echoes the publish URL — stream key and
 * all — on the line that says it could not open it, and that line is exactly what the runtime log
 * and the incident list want to show the operator. Measured on the running channel on
 * 2026-09-01T23:31Z: the Twitch stream key sat in incidents.message and in `docker logs`.
 *
 * This is the one place that knows what a secret looks like in text. It is applied at the sinks
 * (the runtime log, the incident store) and at the stderr readers, so no caller has to remember
 * it. Host and path shape survive: "rtmp://live.twitch.tv/app/<redacted>" still says where the
 * publish failed, which is the part the operator needs.
 */

const REDACTED = "<redacted>";

/** Query parameters whose value is a credential, whatever the scheme. */
const SECRET_QUERY_KEYS = /([?&](?:key|streamkey|stream_key|streamid|token|access_token|refresh_token|passphrase|password|pass|pwd|passwd|secret|api_key|apikey|client_secret|auth|sig|signature|credential)=)[^&\s"'`]+/gi;

/** Publish URLs: the last path segment of an RTMP/RTMPS/SRT URL is the key by convention. */
const PUBLISH_URL_KEY = /((?:rtmps?|srt):\/\/[^\s/"'`]+\/(?:[^\s/?"'`]+\/)*)([^\s/?"'`:,;)\]>]+)/gi;

/** user:password@host — the password. */
const USERINFO_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'`]+:)([^\s@"'`]+)(@)/gi;

/** Discord (and compatible) webhook URLs carry their token as the last segment. */
const WEBHOOK_TOKEN = /(discord(?:app)?\.com\/api\/webhooks\/\d+\/)[\w-]+/gi;

/** "Bearer x", "OAuth x" as they appear in copied headers and error messages. */
const AUTH_HEADER_TOKEN = /\b((?:Bearer|OAuth)\s+)[A-Za-z0-9._~+/=-]{8,}/g;

/** Twitch's own stream-key shape, in case it shows up without its URL. */
const TWITCH_STREAM_KEY = /\blive_\d+_[A-Za-z0-9]{16,}\b/g;

/** Replaces every credential-shaped run in `text` with "<redacted>"; idempotent. */
export function redactSecrets(text: string): string {
  if (!text || typeof text !== "string") {
    return text;
  }
  return text
    .replace(WEBHOOK_TOKEN, `$1${REDACTED}`)
    .replace(USERINFO_PASSWORD, `$1${REDACTED}$3`)
    .replace(SECRET_QUERY_KEYS, `$1${REDACTED}`)
    .replace(PUBLISH_URL_KEY, (match, prefix: string, last: string) =>
      last === REDACTED || last.startsWith("<redacted") ? match : `${prefix}${REDACTED}`
    )
    .replace(AUTH_HEADER_TOKEN, `$1${REDACTED}`)
    .replace(TWITCH_STREAM_KEY, REDACTED);
}

/**
 * Applies redactSecrets to every string inside a value — objects, arrays, nested — and leaves
 * everything else as it is. For log payloads and anything else built from many small strings.
 */
export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecretsDeep(entry)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactSecretsDeep(entry);
    }
    return out as T;
  }
  return value;
}
