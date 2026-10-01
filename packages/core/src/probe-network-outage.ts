/**
 * A failed probe that says nothing about the item or its source: the channel's own network was down (M82).
 *
 * Production (DUT): the host loses its path to the internet once a night, since 2026-09-11 at about
 * 23:58 UTC. The playout's CDN read ends in "Connection reset by peer", the uplink's
 * "Error opening rtmp://live.twitch.tv/...: I/O error" follows within seconds, and the uplink is back
 * after 50 to 70 seconds; on 2026-09-12 the channel answered nothing from outside for about six minutes.
 * While the path is gone every remote resolve fails, and both holds counted that against the content. A
 * failed probe is retried after 60 seconds, so three minutes are three failures of one item: quarantined
 * for good, since a quarantined item is never probed again (asset-probe-quarantine.ts). Three different
 * items are an open source breaker (source-circuit-breaker.ts): in the Twitch-only overnight block, where
 * the blip falls, 30 minutes of fallback after an outage of two.
 *
 * Two questions, both needed. The error text says whether the request got an answer at all
 * (`classifyProbeFailure`). That alone proves nothing about whose fault it was: a dead CDN host fails the
 * same way, and that IS a source fault. So a network-looking failure is left uncounted only when an
 * independent check finds the channel's own way out down at that moment (`decideNetworkOutage`).
 *
 * Pure: the connection attempt itself is apps/worker/src/probe-network-outage.ts.
 */

export type ProbeFailureKind = "network" | "other";
export type NetworkFailureReason = "dns" | "connect" | "timeout" | "tls" | "transport";

/**
 * The remote answered, whatever else the text holds. Checked first: yt-dlp wraps an HTTP status in the same
 * "Unable to download webpage" sentence as a DNS failure, and the worker's "No playable format ..." carries
 * the last candidate's error behind it.
 */
const ANSWERED_PATTERNS: readonly RegExp[] = [
  /requested format is not available/i,
  /video unavailable/i,
  /private video|video is private/i,
  /has been removed|no longer available|account .{0,40}terminated/i,
  /members-only|join this channel/i,
  /sign in to confirm/i,
  /unsupported url/i,
  /does not exist/i,
  /invalid data found/i,
  // "HTTP Error 403: Forbidden", "<HTTPError 429: ...>", ffmpeg's "HTTP error 404 Not Found". A 5xx is an
  // answer too: the host, or the CDN in front of it, was reached.
  /http ?error \d{3}/i,
  /server returned \d/i,
  // A certificate we do not trust is still a peer that answered (a captive portal, a wrong clock).
  /certificate verify failed|certificate_verify_failed/i
];

/**
 * Most specific first: a DNS failure inside yt-dlp's "<urlopen error ...>" is reported as `dns`.
 *
 * Both libc wordings. The image is Alpine (docker/worker.Dockerfile), and musl names the same failures
 * differently from glibc: "Try again" and "Name does not resolve" for "Temporary failure in name
 * resolution" and "Name or service not known", "Network unreachable" for "Network is unreachable", "Host
 * is unreachable" for "No route to host". Measured in the worker image without a network (yt-dlp
 * 2026.08.19): "Unable to download API page: [Errno -3] Try again (caused by TransportError(...))", and
 * ffprobe's "Connection to tcp://...:443 failed: Network unreachable". With the glibc texts alone the
 * first was caught only by the `transport` catch-all and the second not at all.
 */
const NETWORK_PATTERNS: ReadonlyArray<readonly [NetworkFailureReason, RegExp]> = [
  ["dns", /temporary failure in name resolution|name or service not known|name does not resolve/i],
  ["dns", /failed to resolve|could not resolve host/i],
  // Python's resolver error by its number, whatever the libc calls it: -2 is EAI_NONAME, -3 EAI_AGAIN.
  // musl's text for -3, "Try again", is never matched without the number: YouTube's rate limit answers
  // "try again later".
  ["dns", /\[Errno -[23]\]|gaierror\(-[23],/],
  ["dns", /\bgetaddrinfo\b|\bENOTFOUND\b|\bEAI_AGAIN\b|NameResolutionError/],
  ["connect", /connection refused|connection reset|connection aborted|no route to host/i],
  ["connect", /network (?:is )?unreachable|host is unreachable/i],
  ["connect", /remote end closed connection/i],
  ["connect", /\bECONNREFUSED\b|\bECONNRESET\b|\bENETUNREACH\b|\bEHOSTUNREACH\b/],
  // "Connection timed out", "The read operation timed out", "Read timed out. (read timeout=20.0)", and
  // the worker's own resolve timeout, process-utils.ts: "Command timed out after 60000ms and terminated
  // its process group."
  ["timeout", /timed out|\bETIMEDOUT\b|\bETIMEOUT\b|(?:connect|read)(?:ion)? ?timeout/i],
  ["tls", /eof occurred in violation of protocol|unexpected_eof_while_reading|handshake fail/i],
  // ffmpeg's TLS layer when the peer goes away mid-handshake or mid-read.
  ["tls", /error in the pull function|tls connection was non-properly terminated/i],
  // yt-dlp's wrappers around anything its transport raised that the lines above did not name.
  ["transport", /<urlopen error|TransportError|IncompleteRead/]
];

/**
 * Which network failure the error text of a failed probe or resolve names, or null when it names none.
 *
 * `network` only for errors that mean the request never got an answer: name resolution, connecting, a
 * timeout, a TLS handshake that ended in nothing, yt-dlp's transport errors. Anything the remote said --
 * a format that is not offered, a private or removed video, any HTTP status -- is `other`, and so is
 * every text this does not recognise: an unknown error counts as it always did.
 */
export function networkFailureReasonOf(errorText: string): NetworkFailureReason | null {
  const text = errorText || "";
  if (ANSWERED_PATTERNS.some((pattern) => pattern.test(text))) {
    return null;
  }
  for (const [reason, pattern] of NETWORK_PATTERNS) {
    if (pattern.test(text)) {
      return reason;
    }
  }
  return null;
}

export function classifyProbeFailure(errorText: string): ProbeFailureKind {
  return networkFailureReasonOf(errorText) === null ? "other" : "network";
}

/** A host the channel publishes its programme to, as a TCP endpoint. */
export type PublishHostTarget = { host: string; port: number };

/** Publish hosts asked per check. Two cover a primary and a backup output; each one is a connection. */
export const NETWORK_OUTAGE_CHECK_MAX_HOSTS = 2;

// TCP publish protocols only: a connection attempt says nothing about an SRT or RIST listener (UDP).
const DEFAULT_PUBLISH_PORTS: Record<string, number> = {
  "rtmp:": 1935,
  "rtmps:": 443,
  "rtmpt:": 80,
  "rtmpts:": 443,
  "http:": 80,
  "https:": 443
};

/**
 * A host on the channel's own side of the router. Reaching it proves nothing about the way out (a relay
 * container or a LAN restreamer stays reachable through an outage), and failing to reach it is a fault of
 * that box, not of the internet path.
 */
function isLocalPublishHost(host: string): boolean {
  if (host.includes(":")) {
    return /^(?:::1?$|f[cd]|fe[89ab])/.test(host);
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  // A single label is a container or LAN name; the suffixes are the ones reserved for local use.
  return !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home\.arpa)$/.test(host);
}

/**
 * The endpoints to ask whether the channel's way out is up: the hosts of its outputs, the stream key
 * path dropped, local ones left out, each once, the first `limit`.
 */
export function publishHostTargetsOf(
  publishUrls: readonly string[],
  limit = NETWORK_OUTAGE_CHECK_MAX_HOSTS
): PublishHostTarget[] {
  const targets = new Map<string, PublishHostTarget>();
  for (const publishUrl of publishUrls) {
    let url: URL;
    try {
      url = new URL(publishUrl);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const port = url.port ? Number(url.port) : DEFAULT_PUBLISH_PORTS[url.protocol];
    if (!host || !port || !(url.protocol in DEFAULT_PUBLISH_PORTS) || isLocalPublishHost(host)) {
      continue;
    }
    targets.set(`${host}:${port}`, { host, port });
  }
  return [...targets.values()].slice(0, Math.max(0, limit));
}

/** What one connection attempt to a publish host came to; `code` is the resolver's or the socket's. */
export type PublishHostAttempt = { connected: true } | { connected: false; stage: "dns" | "connect"; code: string };

export type PublishHostCheck = PublishHostTarget & {
  /**
   * `connected`: the way out is up. `answered`: it is up too, something replied -- the resolver that the
   * name has no address (a mistyped output URL), the far end with a refusal. `unreachable`: nothing came
   * back (no resolver answer, a timeout, no route).
   */
  outcome: "connected" | "answered" | "unreachable";
  detail: string;
};

export function publishHostCheckOf(target: PublishHostTarget, attempt: PublishHostAttempt): PublishHostCheck {
  if (attempt.connected) {
    return { ...target, outcome: "connected", detail: "" };
  }
  const answered =
    attempt.stage === "dns"
      ? attempt.code === "ENOTFOUND" || attempt.code === "ENODATA"
      : attempt.code === "ECONNREFUSED";
  return { ...target, outcome: answered ? "answered" : "unreachable", detail: `${attempt.stage} ${attempt.code}` };
}

export type NetworkOutageVerdict = {
  outage: boolean;
  /** What the verdict rests on, for the log line. */
  evidence: string;
};

/**
 * Is the channel's own network down right now? Only when every publish host asked was unreachable. One
 * that connects or answers proves a way out, and then a network-looking probe failure is the remote's
 * (YouTube down while Twitch takes the stream is a source fault). With no public publish host to ask
 * there is no evidence, and without evidence every failure counts as it did before M82.
 */
export function decideNetworkOutage(checks: readonly PublishHostCheck[]): NetworkOutageVerdict {
  if (checks.length === 0) {
    return { outage: false, evidence: "no public publish host to ask" };
  }
  const describe = (check: PublishHostCheck) =>
    `${check.host}:${check.port} ${check.outcome}${check.detail ? ` (${check.detail})` : ""}`;
  const reached = checks.find((check) => check.outcome !== "unreachable");
  return reached
    ? { outage: false, evidence: describe(reached) }
    : { outage: true, evidence: checks.map(describe).join(", ") };
}

/** The last time the check found the way out down. */
export type NetworkOutageSighting = { atMs: number; evidence: string };

/**
 * The verdict for a failure that is counted now but whose request went out up to `graceMs` ago.
 *
 * The output is asked when a failure is reported, not when its request failed. A resolve whose packets
 * just vanish ends by the worker's own timeout, 60 s after it started (index.ts,
 * PLAYABLE_INPUT_RESOLVE_TIMEOUT_MS; on the DUT the blip of 2026-09-06 was such a silent drop), and the
 * uplink is back 50 to 70 s after a blip: the last resolve of an outage was judged against a network
 * that had returned, and counted. So an outage the check saw within the length of a resolve still
 * stands. It needs an earlier failure to have asked during the outage; a blip shorter than one resolve
 * with a single slow probe is not seen, and that one failure counts as before.
 */
export function carryRecentNetworkOutage(
  verdict: NetworkOutageVerdict,
  lastOutage: NetworkOutageSighting | null,
  nowMs: number,
  graceMs: number
): NetworkOutageVerdict {
  if (verdict.outage || !lastOutage) {
    return verdict;
  }
  const agoMs = nowMs - lastOutage.atMs;
  if (agoMs < 0 || agoMs > graceMs) {
    return verdict;
  }
  return { outage: true, evidence: `${verdict.evidence}, ${Math.round(agoMs / 1000)} s after ${lastOutage.evidence}` };
}
