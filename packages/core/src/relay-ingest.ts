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
