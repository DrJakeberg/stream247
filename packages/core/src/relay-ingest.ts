// Push ingest through the relay (M57 stage 2, Etappe A).
//
// A pushed camera feed enters mediamtx on a per-source path and is read back inside the
// container network over RTSP. Everything in this module is pure and shared by the three
// parties that must agree on it: the web auth endpoint (mediamtx asks it about every publish
// and read), the database reader that derives the internal playback URL, and — later — the
// worker's attach path. The derived URL is never stored; only the publish key and the internal
// relay key are, both encrypted.

/** Every push source lives on this relay path; the suffix is the stored source id. */
export const RELAY_SOURCE_PATH_PREFIX = "src-";

/**
 * The pre-existing programme path from the relay rollback mode (docs/deployment.md:
 * `STREAM247_RELAY_ENABLED=1` publishes here, the uplink's rtmp rollback reads it). With HTTP
 * auth on the relay this path now also needs a credential — the internal relay key.
 */
export const RELAY_PROGRAM_ROLLBACK_PATH = "live/program";

export function relaySourcePath(sourceId: string): string {
  return `${RELAY_SOURCE_PATH_PREFIX}${sourceId}`;
}

/**
 * The container-internal address of the programme rollback path — the same value the worker falls
 * back to when nothing overrides it (apps/worker/src/ffmpeg-runtime.ts).
 */
export const RELAY_PROGRAM_ROLLBACK_BASE_URL = `rtmp://relay:1935/${RELAY_PROGRAM_ROLLBACK_PATH}`;

/**
 * The programme rollback address WITH the internal relay key embedded (M57 stage 2, Etappe E).
 *
 * Since the relay checks credentials, the two documented emergency rollback paths — publishing the
 * programme to the relay, and reading it back on the uplink's rtmp input — only work when the
 * configured URLs carry the internal key. Nothing could produce that string, which quietly turned a
 * documented emergency path into an unusable one; this is the missing derivation.
 *
 * Fail closed on an empty key: a URL with an empty password authenticates against nothing, and
 * handing an operator such a line during an incident would read as a working rollback and fail as
 * "wrong password". The credential is percent-encoded because the line is pasted into an
 * environment file, where an unescaped `&` would silently truncate it.
 */
export function deriveRelayProgramRollbackUrl(internalKey: string): string {
  if (!internalKey) {
    return "";
  }
  return `${RELAY_PROGRAM_ROLLBACK_BASE_URL}?user=internal&pass=${encodeURIComponent(internalKey)}`;
}

/**
 * The environment keys the rollback lines are copied into. They live next to the derivation rather
 * than in the component that renders them: an operator copies whole `KEY=value` lines, so the key
 * is part of the value being produced, not prose on a page.
 */
export const RELAY_ROLLBACK_ENV_KEYS = ["STREAM247_RELAY_OUTPUT_URL", "STREAM247_RELAY_INPUT_URL"] as const;

/** Both rollback lines, ready to paste — or nothing at all when no key exists yet. */
export function buildRelayRollbackEnvLines(internalKey: string): string[] {
  const url = deriveRelayProgramRollbackUrl(internalKey);
  return url ? RELAY_ROLLBACK_ENV_KEYS.map((key) => `${key}=${url}`) : [];
}

/**
 * The source id inside a relay source path, or null when the path is anything else. Strict on
 * purpose: the auth policy treats "not exactly one source path" as "not a source path at all",
 * so a crafted path can never alias into a known source's credential check.
 */
export function parseRelaySourcePath(path: string): string | null {
  if (!path.startsWith(RELAY_SOURCE_PATH_PREFIX)) {
    return null;
  }

  const sourceId = path.slice(RELAY_SOURCE_PATH_PREFIX.length);
  // Stored source ids are lowercase slugs (the web route sanitises them to [a-z0-9-]); anything
  // else — empty, nested, uppercase — is not a path this workspace ever handed out.
  return /^[a-z0-9-]+$/.test(sourceId) ? sourceId : null;
}

/**
 * The internal playback URL for a push source — derived on read, never persisted. RTSP because
 * that is the relay protocol the container network uses (and the snapshot sampler already pins
 * RTSP to TCP transport); `reader` is cosmetic, the credential is the internal relay key.
 */
export function deriveRelaySourceReadUrl(sourceId: string, internalKey: string): string {
  return `rtsp://reader:${internalKey}@relay:8554/${relaySourcePath(sourceId)}`;
}

/**
 * Constant-time string comparison.
 *
 * The repo's server-side pattern is `crypto.timingSafeEqual` (see the session-cookie check in
 * apps/web/lib/server/auth.ts and the OAuth state check). This module cannot use it: the core
 * barrel is imported by client components, and a `node:crypto` import here would follow it into
 * the browser bundle. So the same property is built by hand — every character position is read
 * exactly once whichever position differs, the verdict is accumulated bitwise, and only the
 * final accumulator branches. (`charCodeAt` past the end yields NaN, which `^` coerces to 0, so
 * unequal lengths fold into the accumulator instead of exiting early.)
 *
 * The loop runs max(len(a), len(b)) iterations, so the length of the presented credential is
 * observable through timing. That is accepted: the secrets compared here (publish keys, the
 * internal relay key) are fixed-length generated values whose length is not itself secret — only
 * their content is.
 */
export function constantTimeEqualStrings(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** The relevant fields of mediamtx 1.15's authHTTPAddress POST body. */
export type RelayAuthRequest = {
  user: string;
  password: string;
  ip: string;
  path: string;
  action: string;
  protocol: string;
  query: string;
};

export type RelayIngestSourceCredential = {
  id: string;
  ingestKind: "pull" | "push";
  /** Decrypted publish key; "" when the source has none (every pull source). */
  publishKey: string;
};

export type RelayAuthDecision =
  | { allow: true; role: "source-publisher" | "internal" }
  | {
      allow: false;
      /** For the audit trail only — the HTTP answer must stay a bare 403 either way. */
      reason:
        | "unknown-action"
        | "unknown-publish-path"
        | "bad-source-key"
        | "bad-internal-key";
    };

/**
 * The whole relay auth policy, as one pure decision.
 *
 * - publish on `src-<id>`: only that push source's publish key
 * - publish on the programme rollback path, and read on any path: only the internal relay key
 * - everything else: deny
 *
 * Every branch performs exactly one constant-time comparison, including the ones that can never
 * allow (unknown path, unknown action, source without a key — those compare against an
 * impossible expectation), so the response time does not say which kind of rejection happened.
 * An empty expected credential never matches: "" === "" is a configuration hole, not a login.
 */
export function evaluateRelayAuth(args: {
  request: RelayAuthRequest;
  sources: RelayIngestSourceCredential[];
  internalKey: string;
}): RelayAuthDecision {
  const presented = args.request.password || "";
  const matches = (expected: string): boolean => {
    // The comparison runs before the emptiness guard so that every branch costs one comparison,
    // whether or not it could ever succeed.
    const equal = constantTimeEqualStrings(presented, expected);
    return expected !== "" && equal;
  };

  if (args.request.action === "publish") {
    const sourceId = parseRelaySourcePath(args.request.path);
    if (sourceId !== null) {
      // A full scan rather than find(), so the loop's duration does not reveal the matching
      // source's position in the list (or whether one exists at all). Source ids are effectively
      // public, so this only closes a low-value oracle — but the scan is free at this list size.
      let expected = "";
      for (const entry of args.sources) {
        if (entry.id === sourceId && entry.ingestKind === "push") {
          expected = entry.publishKey;
        }
      }
      return matches(expected) ? { allow: true, role: "source-publisher" } : { allow: false, reason: "bad-source-key" };
    }

    if (args.request.path === RELAY_PROGRAM_ROLLBACK_PATH) {
      return matches(args.internalKey) ? { allow: true, role: "internal" } : { allow: false, reason: "bad-internal-key" };
    }

    matches("");
    return { allow: false, reason: "unknown-publish-path" };
  }

  if (args.request.action === "read") {
    return matches(args.internalKey) ? { allow: true, role: "internal" } : { allow: false, reason: "bad-internal-key" };
  }

  matches("");
  return { allow: false, reason: "unknown-action" };
}

// ---------------------------------------------------------------------------
// The live attach state, as an operator reads it (M57 stage 2, Etappe E)
// ---------------------------------------------------------------------------

/**
 * The worker's own decision vocabulary (apps/worker/src/relay-presence.ts), stored per source so a
 * surface can show the last known state. Kept as a plain string on the way in: a value written by
 * an older or newer worker must read as "nothing known" rather than break a listing.
 */
export type SourceLiveStateName =
  | "publishing"
  | "not-publishing"
  | "breaker-cooldown"
  | "switched-off"
  | "no-source-layer"
  | "presence-unknown"
  /** Decided to attach, but it never became an input: no address to read, or a start that took none. */
  | "attach-unavailable"
  /** Nothing is playing that a camera could join — a live bridge or the standby slate. */
  | "not-asset-playout";

/**
 * The stored decision as a sentence.
 *
 * Deliberately without a catch-all default sentence: an unrecognised value returns the empty string
 * so the surface shows nothing rather than inventing a state. The live case names the condition its
 * sound actually depends on — a live attach mixes the source's audio only into items whose length is
 * known in advance (the safety invariant from stage 2 C+D) — because without that line an operator
 * looking at a live camera with no sound cannot tell a fault from the design.
 */
export function describeSourceLiveState(input: { state: string; retryAt?: string; nowMs?: number }): string {
  switch (input.state) {
    case "publishing":
      return "Live in the programme. Its sound comes along only on items whose length is known in advance.";
    case "not-publishing":
      return "Waiting for the camera.";
    case "breaker-cooldown":
      return `Paused after a failed attempt. ${describeAttachRetry(input.retryAt, input.nowMs)}`;
    case "switched-off":
    case "no-source-layer":
      return "Still picture only.";
    case "presence-unknown":
      return "Still picture only. The camera could not be checked just now.";
    case "attach-unavailable":
      return "Still picture only. The live connection could not be prepared.";
    case "not-asset-playout":
      return "Still picture only. A camera joins only while a recorded item is playing.";
    default:
      return "";
  }
}

/**
 * How much of the cooldown is left. A retry moment that has already passed is not turned into a
 * negative countdown: the stored state is simply older than the cooldown, and saying the next
 * attempt is due is the honest reading of that.
 */
function describeAttachRetry(retryAt: string | undefined, nowMs: number | undefined): string {
  const retryAtMs = Date.parse(retryAt || "");
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  if (!Number.isFinite(retryAtMs) || retryAtMs <= now) {
    return "The next attempt is due.";
  }

  const minutes = Math.ceil((retryAtMs - now) / 60_000);
  return minutes <= 1 ? "Trying again in about a minute." : `Trying again in about ${String(minutes)} minutes.`;
}
