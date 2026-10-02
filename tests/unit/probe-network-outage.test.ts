import { createServer, type AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSET_PROBE_QUARANTINE_THRESHOLD,
  carryRecentNetworkOutage,
  classifyProbeFailure,
  decideNetworkOutage,
  networkFailureReasonOf,
  planAssetProbeUpdates,
  planSourceBreakerUpdates,
  publishHostCheckOf,
  publishHostTargetsOf,
  sourceBreakerGate,
  sourceBreakerPhase,
  type PublishHostAttempt,
  type PublishHostTarget,
  type SourceBreakerRecord
} from "@stream247/core";
import {
  attemptPublishHost,
  createNetworkOutageCheck,
  networkLookingFailuresOf,
  ProbeOutageLogLimiter,
  withoutNetworkOutageOutcomes
} from "../../apps/worker/src/probe-network-outage.js";
import { sourceBreakerOutcomesOf, type QueueProbeOutcome } from "../../apps/worker/src/source-breaker-outcomes.js";

// M82. The DUT's nightly blip (23:58 UTC since 2026-09-11): every remote resolve fails for one to four
// minutes, and until now each failure counted against the item (quarantine) and its source (breaker).

describe("which probe errors are a network failure", () => {
  const network: Array<[string, string]> = [
    // yt-dlp, both phrasings of its transport errors (urllib before 2023.10, the request handlers since).
    ["dns", "ERROR: [youtube] j4YdbIbEc9E: Unable to download API page: <urlopen error [Errno -3] Temporary failure in name resolution> (caused by URLError(gaierror(-3, 'Temporary failure in name resolution')))"],
    ["dns", "ERROR: [youtube] j4YdbIbEc9E: Unable to download webpage: [Errno -2] Name or service not known (caused by TransportError('[Errno -2] Name or service not known'))"],
    ["dns", "ERROR: [twitch:vod] 2561234567: Unable to download JSON metadata: HTTPSConnectionPool(host='gql.twitch.tv', port=443): Max retries exceeded with url: /gql (Caused by NameResolutionError(\"<urllib3.connection.HTTPSConnection object at 0x7f3a>: Failed to resolve 'gql.twitch.tv' ([Errno -3] Temporary failure in name resolution)\"))"],
    ["connect", "ERROR: [twitch:vod] 2561234567: Unable to download JSON metadata: [Errno 101] Network is unreachable (caused by TransportError('[Errno 101] Network is unreachable'))"],
    ["connect", "ERROR: [youtube] j4YdbIbEc9E: Unable to download webpage: [Errno 113] No route to host (caused by TransportError('[Errno 113] No route to host'))"],
    ["connect", "ERROR: [youtube] j4YdbIbEc9E: Unable to download webpage: [Errno 111] Connection refused (caused by TransportError('[Errno 111] Connection refused'))"],
    ["connect", "ERROR: [youtube] j4YdbIbEc9E: Unable to download webpage: [Errno 104] Connection reset by peer (caused by TransportError('[Errno 104] Connection reset by peer'))"],
    ["connect", "ERROR: [youtube] j4YdbIbEc9E: Unable to download API page: ('Connection aborted.', RemoteDisconnected('Remote end closed connection without response'))"],
    ["timeout", "ERROR: [youtube] j4YdbIbEc9E: Unable to download API page: The read operation timed out (caused by TransportError('The read operation timed out'))"],
    ["timeout", "ERROR: [youtube] j4YdbIbEc9E: Unable to download API page: HTTPSConnectionPool(host='www.youtube.com', port=443): Read timed out. (read timeout=20.0)"],
    ["timeout", "ERROR: [youtube] j4YdbIbEc9E: Unable to download webpage: _ssl.c:980: The handshake operation timed out"],
    ["tls", "ERROR: [youtube] j4YdbIbEc9E: Unable to download webpage: [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol (_ssl.c:1007) (caused by SSLError('[SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol (_ssl.c:1007)'))"],
    ["transport", "ERROR: [youtube] j4YdbIbEc9E: Unable to download webpage: <urlopen error [Errno 0] Error> (caused by URLError(OSError(0, 'Error')))"],
    ["transport", "ERROR: [twitch:vod] 2561234567: Unable to download m3u8 information: IncompleteRead(0 bytes read)"],
    // The same failures as the production image words them: Alpine, so musl, not glibc. The first five
    // are what stream247-worker:test printed with `--network none` (yt-dlp 2026.08.19, ffprobe), the
    // worker's own yt-dlp flags, 2026-10-01; before these rows the yt-dlp ones were `transport` by the
    // catch-all and ffprobe's "Network unreachable" was `other`.
    ["dns", "ERROR: [youtube] dQw4w9WgXcQ: Unable to download API page: [Errno -3] Try again (caused by TransportError('[Errno -3] Try again'))"],
    ["dns", "ERROR: [twitch:vod] 2000000000: Unable to download JSON metadata: [Errno -3] Try again (caused by TransportError('[Errno -3] Try again'))"],
    ["connect", "ERROR: [generic] x: Unable to download webpage: [Errno 101] Network unreachable (caused by TransportError('[Errno 101] Network unreachable'))"],
    ["connect", "[tcp @ 0x7f025e2eeec0] Connection to tcp://203.0.113.9:443 failed: Network unreachable\nhttps://203.0.113.9/x.m3u8: Network unreachable"],
    ["dns", "[tcp @ 0x77026e8f0e40] Failed to resolve hostname usher.ttvnw.net: Try again\nhttps://usher.ttvnw.net/x.m3u8: I/O error"],
    ["dns", "ERROR: [youtube] j4YdbIbEc9E: Unable to download webpage: [Errno -2] Name does not resolve (caused by TransportError('[Errno -2] Name does not resolve'))"],
    ["connect", "[tcp @ 0x55d0c8a3e2c0] Connection to tcp://usher.ttvnw.net:443 failed: Host is unreachable"],
    ["timeout", "[tcp @ 0x55d0c8a3e2c0] Connection to tcp://usher.ttvnw.net:443 failed: Operation timed out"],
    // The bare texts, without yt-dlp's wrapper to fall back on.
    ["dns", "[Errno -3] Try again"],
    ["dns", "[Errno -2] Name does not resolve"],
    ["dns", "gaierror(-3, 'Try again')"],
    ["dns", "Name does not resolve"],
    ["connect", "[Errno 101] Network unreachable"],
    ["connect", "[Errno 113] Host is unreachable"],
    // The worker's own resolve timeout, process-utils.ts execFileText, with and without yt-dlp's stderr.
    ["timeout", "Command timed out after 60000ms and terminated its process group."],
    ["timeout", "Command timed out after 60000ms and terminated the child process."],
    // ffprobe and ffmpeg on a remote URL. The second is the playout's own line at the DUT's blip.
    ["dns", "Failed to resolve hostname d2nvs31859zcd8.cloudfront.net: Temporary failure in name resolution"],
    ["connect", "https://d2nvs31859zcd8.cloudfront.net/chunked/1234.ts: Connection reset by peer"],
    ["connect", "[tcp @ 0x55d0c8a3e2c0] Connection to tcp://usher.ttvnw.net:443 failed: Connection refused"],
    ["connect", "[tcp @ 0x55d0c8a3e2c0] Connection to tcp://usher.ttvnw.net:443 failed: Network is unreachable"],
    ["timeout", "[tcp @ 0x55d0c8a3e2c0] Connection to tcp://usher.ttvnw.net:443 failed: Connection timed out"],
    ["tls", "[tls @ 0x55d0c8a40f00] Error in the pull function."],
    ["tls", "[tls @ 0x55d0c8a40f00] The TLS connection was non-properly terminated."],
    // node.
    ["dns", "getaddrinfo ENOTFOUND gql.twitch.tv"],
    ["dns", "getaddrinfo EAI_AGAIN www.youtube.com"],
    ["connect", "connect ECONNREFUSED 151.101.2.167:443"],
    ["connect", "read ECONNRESET"],
    ["connect", "connect ENETUNREACH 151.101.2.167:443"],
    ["connect", "connect EHOSTUNREACH 151.101.2.167:443"],
    ["timeout", "connect ETIMEDOUT 151.101.2.167:443"]
  ];

  it.each(network)("network (%s): %s", (reason, error) => {
    expect(networkFailureReasonOf(error)).toBe(reason);
    expect(classifyProbeFailure(error)).toBe("network");
  });

  const other: string[] = [
    // What the remote said about the item: the DUT cases behind quarantine (2026-09-07) and the breaker
    // (2026-09-28).
    "ERROR: [youtube] j4YdbIbEc9E: Requested format is not available. Use --list-formats for a list of available formats",
    "No playable format for https://www.youtube.com/watch (tried split-h264-aac, split-any, combined, split-any-height). ERROR: [youtube] j4YdbIbEc9E: Requested format is not available. Use --list-formats for a list of available formats",
    "ERROR: [youtube] abc: Video unavailable. This video is private",
    "ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video",
    "ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader",
    "ERROR: [youtube] abc: Join this channel to get access to members-only content like this video, and other exclusive perks.",
    "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.",
    "ERROR: [twitch:vod] 2561234567: Video 2561234567 does not exist",
    "ERROR: Unsupported URL: https://example.com/clip",
    // musl's "Try again" counts only with the resolver's error number: this is YouTube answering.
    "ERROR: [youtube] abc: This content isn't available, try again later. The current session has been rate-limited by YouTube for up to an hour.",
    "Try again",
    // An HTTP status is an answer, 4xx and 5xx alike, also inside the sentence a DNS failure uses.
    "ERROR: [youtube] abc: Unable to download webpage: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)",
    "ERROR: unable to download video data: HTTP Error 403: Forbidden",
    "ERROR: [generic] Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)",
    "ERROR: [twitch:vod] 2561234567: Unable to download JSON metadata: HTTP Error 410: Gone",
    "ERROR: [youtube] abc: Unable to download API page: HTTP Error 503: Service Unavailable (caused by <HTTPError 503: Service Unavailable>)",
    "ERROR: [generic] Unable to download webpage: HTTP Error 522: <none> (caused by <HTTPError 522: <none>>)",
    "[https @ 0x55d0] HTTP error 403 Forbidden",
    "Server returned 404 Not Found",
    "Server returned 5XX Server Error reply",
    "ERROR: [youtube] abc: Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1007) (caused by CertificateVerifyError('...'))",
    // ffprobe on a file that is not media, and the worker's own messages.
    "/media/vod-cache/a.part-resume.mp4: Invalid data found when processing input",
    "Twitch VOD cache is missing: Twitch VOD is not cached yet.",
    "Twitch VOD cache is missing: Twitch VOD cache is disabled.",
    "Downloaded Twitch VOD cache file is empty.",
    "yt-dlp printed 0 of 5 expected fields.",
    "No playable format for https://www.youtube.com/watch (tried split-h264-aac). yt-dlp returned format 299 without a URL.",
    "Command exceeded the 20971520 byte output limit and was terminated.",
    "Command exited with code 1.",
    "spawn yt-dlp ENOENT",
    "Unknown queue prefetch error.",
    // Not named by the rules: an unknown error counts as it always did.
    "Error opening input: I/O error",
    ""
  ];

  it.each(other)("other: %s", (error) => {
    expect(networkFailureReasonOf(error)).toBeNull();
    expect(classifyProbeFailure(error)).toBe("other");
  });
});

describe("which hosts are asked whether the channel's way out is up", () => {
  it("takes the host and port of each output, without the path a stream key would ride in", () => {
    expect(publishHostTargetsOf(["rtmp://live.twitch.tv/app"])).toEqual([{ host: "live.twitch.tv", port: 1935 }]);
    expect(publishHostTargetsOf(["rtmps://a.rtmps.youtube.com/live2", "rtmp://ingest.example.com:1936/live"])).toEqual([
      { host: "a.rtmps.youtube.com", port: 443 },
      { host: "ingest.example.com", port: 1936 }
    ]);
  });

  it("asks each host once and at most two of them", () => {
    expect(
      publishHostTargetsOf([
        "rtmp://live.twitch.tv/app",
        "rtmp://LIVE.twitch.tv:1935/app2",
        "rtmp://a.rtmp.youtube.com/live2",
        "rtmp://live.kick.example.com/app"
      ])
    ).toEqual([
      { host: "live.twitch.tv", port: 1935 },
      { host: "a.rtmp.youtube.com", port: 1935 }
    ]);
  });

  // A relay container or a LAN restreamer stays reachable through an internet outage, and its being down
  // is not one: neither may decide.
  it.each([
    "rtmp://localhost/live",
    "rtmp://relay:1935/live",
    "rtmp://127.0.0.1/live",
    "rtmp://10.11.50.20/live",
    "rtmp://172.20.0.5:1935/live",
    "rtmp://192.168.1.10/live",
    "rtmp://100.100.3.4/live",
    "rtmp://169.254.1.1/live",
    "rtmp://restream.lan/live",
    "rtmp://nas.local/live",
    "rtmp://[::1]/live",
    "rtmp://[fd12:3456::1]/live",
    "rtmp://[fe80::1]/live"
  ])("leaves out the local host %s", (url) => {
    expect(publishHostTargetsOf([url])).toEqual([]);
  });

  it("leaves out what a TCP connection cannot ask, and what is not a URL", () => {
    expect(publishHostTargetsOf(["srt://ingest.example.com:9000", "", "live.twitch.tv/app", "/program/index.m3u8"])).toEqual([]);
    expect(publishHostTargetsOf(["rtmp://[2001:db8::10]/live", "rtmp://203.0.113.9/live"])).toEqual([
      { host: "2001:db8::10", port: 1935 },
      { host: "203.0.113.9", port: 1935 }
    ]);
  });
});

describe("whether the channel's own network is down", () => {
  const twitch: PublishHostTarget = { host: "live.twitch.tv", port: 1935 };
  const youtube: PublishHostTarget = { host: "a.rtmp.youtube.com", port: 1935 };
  const failed = (stage: "dns" | "connect", code: string): PublishHostAttempt => ({ connected: false, stage, code });

  it.each([
    [{ connected: true } as PublishHostAttempt, "connected"],
    // Nothing came back.
    [failed("dns", "ETIMEOUT"), "unreachable"],
    [failed("dns", "ESERVFAIL"), "unreachable"],
    [failed("dns", "ECONNREFUSED"), "unreachable"],
    [failed("connect", "ETIMEDOUT"), "unreachable"],
    [failed("connect", "ENETUNREACH"), "unreachable"],
    [failed("connect", "EHOSTUNREACH"), "unreachable"],
    [failed("connect", "ECONNRESET"), "unreachable"],
    // Something answered: the resolver (no such name: a mistyped output URL), the far end (a refusal).
    [failed("dns", "ENOTFOUND"), "answered"],
    [failed("dns", "ENODATA"), "answered"],
    [failed("connect", "ECONNREFUSED"), "answered"]
  ])("reads the attempt %j as %s", (attempt, outcome) => {
    expect(publishHostCheckOf(twitch, attempt).outcome).toBe(outcome);
  });

  it("is an outage only when every publish host asked was unreachable", () => {
    const down = decideNetworkOutage([publishHostCheckOf(twitch, failed("connect", "ETIMEDOUT"))]);
    expect(down).toEqual({ outage: true, evidence: "live.twitch.tv:1935 unreachable (connect ETIMEDOUT)" });
    expect(
      decideNetworkOutage([
        publishHostCheckOf(twitch, failed("dns", "ESERVFAIL")),
        publishHostCheckOf(youtube, failed("dns", "ESERVFAIL"))
      ])
    ).toEqual({
      outage: true,
      evidence: "live.twitch.tv:1935 unreachable (dns ESERVFAIL), a.rtmp.youtube.com:1935 unreachable (dns ESERVFAIL)"
    });
  });

  it("is no outage when one publish host connects or answers: the way out is up", () => {
    expect(decideNetworkOutage([publishHostCheckOf(twitch, { connected: true })])).toEqual({
      outage: false,
      evidence: "live.twitch.tv:1935 connected"
    });
    // One ingest gone while the other takes the stream is that ingest's fault.
    expect(
      decideNetworkOutage([
        publishHostCheckOf(twitch, failed("connect", "ETIMEDOUT")),
        publishHostCheckOf(youtube, { connected: true })
      ])
    ).toEqual({ outage: false, evidence: "a.rtmp.youtube.com:1935 connected" });
    expect(decideNetworkOutage([publishHostCheckOf(twitch, failed("connect", "ECONNREFUSED"))])).toEqual({
      outage: false,
      evidence: "live.twitch.tv:1935 answered (connect ECONNREFUSED)"
    });
  });

  it("is no outage without a public publish host to ask: no evidence, so everything counts as before", () => {
    expect(decideNetworkOutage([])).toEqual({ outage: false, evidence: "no public publish host to ask" });
  });

  // A resolve whose packets vanish ends by the worker's own timeout 60 s after it started, and the uplink
  // is back 50 to 70 s after a blip: the failure is reported to a network that has returned.
  describe("for a failure reported after the network came back", () => {
    const up = { outage: false, evidence: "live.twitch.tv:1935 connected" };
    const seen = { atMs: 100_000, evidence: "live.twitch.tv:1935 unreachable (connect ETIMEDOUT)" };
    const GRACE = 60_000;

    it.each([
      [0, true],
      [42_000, true],
      [60_000, true],
      [60_001, false],
      [10 * 60_000, false],
      // A clock that stepped back proves nothing.
      [-1, false]
    ])("an outage seen %i ms ago, with a resolve of 60 s: outage %s", (agoMs, outage) => {
      expect(carryRecentNetworkOutage(up, seen, seen.atMs + agoMs, GRACE).outage).toBe(outage);
    });

    it("names both in the evidence: what the output says now and what it said then", () => {
      expect(carryRecentNetworkOutage(up, seen, seen.atMs + 42_000, GRACE)).toEqual({
        outage: true,
        evidence: "live.twitch.tv:1935 connected, 42 s after live.twitch.tv:1935 unreachable (connect ETIMEDOUT)"
      });
    });

    it("changes nothing without an earlier outage, without a grace, or when the outage is on now", () => {
      expect(carryRecentNetworkOutage(up, null, 100_000, GRACE)).toBe(up);
      expect(carryRecentNetworkOutage(up, seen, seen.atMs + 1, 0)).toBe(up);
      const down = { outage: true, evidence: "live.twitch.tv:1935 unreachable (dns ETIMEOUT)" };
      expect(carryRecentNetworkOutage(down, seen, seen.atMs + 1, GRACE)).toBe(down);
    });
  });
});

describe("the connection attempt", () => {
  const listen = () =>
    new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
      const server = createServer((socket) => socket.destroy());
      server.listen(0, "127.0.0.1", () => {
        resolve({
          port: (server.address() as AddressInfo).port,
          close: () => new Promise<void>((done) => server.close(() => done()))
        });
      });
    });

  it("connects to a listening port and is refused by a closed one, with a real socket", async () => {
    const server = await listen();
    expect(await attemptPublishHost({ host: "127.0.0.1", port: server.port }, 2_000)).toEqual({ connected: true });
    await server.close();
    expect(await attemptPublishHost({ host: "127.0.0.1", port: server.port }, 2_000)).toEqual({
      connected: false,
      stage: "connect",
      code: "ECONNREFUSED"
    });
  });

  it("resolves a name first, and stops there when the resolver gives nothing", async () => {
    const connected: Array<[string, number]> = [];
    const connect = async (address: string, port: number) => {
      connected.push([address, port]);
      return { connected: true as const };
    };
    expect(
      await attemptPublishHost({ host: "live.twitch.tv", port: 1935 }, 2_000, {
        resolve: async () => ({ address: "203.0.113.7" }),
        connect
      })
    ).toEqual({ connected: true });
    expect(connected).toEqual([["203.0.113.7", 1935]]);

    expect(
      await attemptPublishHost({ host: "live.twitch.tv", port: 1935 }, 2_000, {
        resolve: async () => ({ code: "ESERVFAIL" }),
        connect
      })
    ).toEqual({ connected: false, stage: "dns", code: "ESERVFAIL" });
    expect(connected).toHaveLength(1);
  });

  it("reports a connection that times out or finds no route", async () => {
    for (const code of ["ETIMEDOUT", "ENETUNREACH"]) {
      expect(
        await attemptPublishHost({ host: "203.0.113.7", port: 1935 }, 2_000, { connect: async () => ({ code }) })
      ).toEqual({ connected: false, stage: "connect", code });
    }
  });
});

describe("the outage check the playout calls", () => {
  const twitch: PublishHostTarget = { host: "live.twitch.tv", port: 1935 };
  const down: PublishHostAttempt = { connected: false, stage: "connect", code: "ETIMEDOUT" };

  it("says outage when the publish host is unreachable, and no outage when it connects", async () => {
    const unreachable = createNetworkOutageCheck({ attempt: async () => down });
    expect(await unreachable([twitch])).toEqual({ outage: true, evidence: "live.twitch.tv:1935 unreachable (connect ETIMEDOUT)" });
    const reachable = createNetworkOutageCheck({ attempt: async () => ({ connected: true }) });
    expect(await reachable([twitch])).toEqual({ outage: false, evidence: "live.twitch.tv:1935 connected" });
  });

  it("asks once per ten seconds: one verdict serves a cycle's inline resolve and its scan", async () => {
    let nowMs = 0;
    let asked = 0;
    let attempt: PublishHostAttempt = down;
    const check = createNetworkOutageCheck({
      attempt: async () => {
        asked += 1;
        return attempt;
      },
      now: () => nowMs
    });
    expect((await check([twitch])).outage).toBe(true);
    nowMs = 9_000;
    attempt = { connected: true };
    expect((await check([twitch])).outage).toBe(true);
    expect(asked).toBe(1);
    // The next cycle, 15 s later, asks again and sees the network back.
    nowMs = 15_000;
    expect((await check([twitch])).outage).toBe(false);
    expect(asked).toBe(2);
  });

  it("asks every target at once, and again when the outputs change", async () => {
    const asked: string[] = [];
    const check = createNetworkOutageCheck({
      attempt: async (target) => {
        asked.push(target.host);
        return down;
      },
      now: () => 0
    });
    await check([twitch, { host: "a.rtmp.youtube.com", port: 1935 }]);
    await check([twitch]);
    expect(asked).toEqual(["live.twitch.tv", "a.rtmp.youtube.com", "live.twitch.tv"]);
  });

  it("opens no connection without a target, and takes a broken check as no evidence", async () => {
    let asked = 0;
    const none = createNetworkOutageCheck({
      attempt: async () => {
        asked += 1;
        return down;
      }
    });
    expect(await none([])).toEqual({ outage: false, evidence: "no public publish host to ask" });
    expect(asked).toBe(0);
    const broken = createNetworkOutageCheck({
      attempt: async () => {
        throw new Error("resolver unavailable");
      }
    });
    // Flagged, so the playout can say so: "no outage" alone reads like a reachable output.
    expect(await broken([twitch])).toEqual({
      outage: false,
      evidence: "outage check failed: resolver unavailable",
      checkFailed: true
    });
    for (const attempt of [down, { connected: true } as PublishHostAttempt]) {
      expect(await createNetworkOutageCheck({ attempt: async () => attempt })([twitch])).not.toHaveProperty("checkFailed");
    }
    expect(await none([])).not.toHaveProperty("checkFailed");
  });

  // The last resolve of an outage: started while the way out was down, killed by its 60 s timeout, and
  // reported when the output connects again.
  it("lets an outage it saw stand for the length of a resolve, and no longer", async () => {
    let nowMs = 0;
    let attempt: PublishHostAttempt = down;
    const check = createNetworkOutageCheck({ attempt: async () => attempt, now: () => nowMs, graceMs: 60_000 });
    expect((await check([twitch])).outage).toBe(true);
    attempt = { connected: true };
    nowMs = 45_000;
    expect(await check([twitch])).toEqual({
      outage: true,
      evidence: "live.twitch.tv:1935 connected, 45 s after live.twitch.tv:1935 unreachable (connect ETIMEDOUT)"
    });
    // Asked afresh each time: the grace is not the cache.
    nowMs = 60_000;
    expect((await check([twitch])).outage).toBe(true);
    nowMs = 75_000;
    expect(await check([twitch])).toEqual({ outage: false, evidence: "live.twitch.tv:1935 connected" });
    // A connected output is not remembered as anything: only a sighting of the outage is.
    nowMs = 90_000;
    expect((await check([twitch])).outage).toBe(false);
  });

  it("counts from the last time the outage was seen, not the first", async () => {
    let nowMs = 0;
    let attempt: PublishHostAttempt = down;
    const check = createNetworkOutageCheck({ attempt: async () => attempt, now: () => nowMs, graceMs: 60_000 });
    for (nowMs of [0, 60_000, 120_000, 180_000]) {
      expect((await check([twitch])).outage).toBe(true);
    }
    attempt = { connected: true };
    nowMs = 235_000;
    expect((await check([twitch])).evidence).toContain("55 s after");
    nowMs = 250_000;
    expect((await check([twitch])).outage).toBe(false);
  });

  it("carries no outage without a grace, to other outputs, or past a broken check", async () => {
    let nowMs = 0;
    let attempt: PublishHostAttempt | Error = down;
    const ask = async () => {
      if (attempt instanceof Error) {
        throw attempt;
      }
      return attempt;
    };
    // Without a grace the verdict is the output's answer alone.
    const plain = createNetworkOutageCheck({ attempt: ask, now: () => nowMs });
    expect((await plain([twitch])).outage).toBe(true);
    attempt = { connected: true };
    nowMs = 15_000;
    expect((await plain([twitch])).outage).toBe(false);

    // What live.twitch.tv said is no evidence once the channel publishes elsewhere, or nowhere public.
    nowMs = 0;
    attempt = down;
    const moved = createNetworkOutageCheck({ attempt: ask, now: () => nowMs, graceMs: 60_000 });
    expect((await moved([twitch])).outage).toBe(true);
    attempt = { connected: true };
    nowMs = 15_000;
    expect(await moved([])).toEqual({ outage: false, evidence: "no public publish host to ask" });
    nowMs = 30_000;
    expect(await moved([twitch])).toEqual({ outage: false, evidence: "live.twitch.tv:1935 connected" });

    // A broken check is no evidence, however recent the outage: everything counts, and it is flagged.
    nowMs = 0;
    attempt = down;
    const breaks = createNetworkOutageCheck({ attempt: ask, now: () => nowMs, graceMs: 60_000 });
    expect((await breaks([twitch])).outage).toBe(true);
    attempt = new Error("resolver unavailable");
    nowMs = 15_000;
    expect(await breaks([twitch])).toMatchObject({ outage: false, checkFailed: true });
  });
});

describe("the outage log line", () => {
  it("is written once per item per five minutes, with the count it left out", () => {
    const limiter = new ProbeOutageLogLimiter();
    const minute = 60_000;
    expect(limiter.take("asset_a", 0)).toBe(0);
    // A six-minute outage re-probes a queued item once a minute: two lines, not six.
    expect([1, 2, 3, 4, 5].map((at) => limiter.take("asset_a", at * minute))).toEqual([null, null, null, null, null]);
    expect(limiter.take("asset_a", 5 * minute + 1)).toBe(5);
    expect(limiter.take("asset_a", 6 * minute)).toBeNull();
    // Per item: another item's first line is not held back.
    expect(limiter.take("asset_b", 6 * minute)).toBe(0);
    // The next night's first line carries what the last one left unwritten; an item not seen since is forgotten.
    expect(limiter.take("asset_a", 24 * 60 * minute)).toBe(1);
    expect(limiter.take("asset_b", 24 * 60 * minute)).toBe(0);
  });
});

describe("what quarantine and the breaker count during an outage", () => {
  const TWITCH = "source_e2au8vv3";
  const YOUTUBE = "source_jjwuu0f3";
  const T0 = Date.parse("2026-09-12T23:58:18.000Z");
  const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
  const dns = "ERROR: [youtube] j4YdbIbEc9E: Unable to download API page: <urlopen error [Errno -3] Temporary failure in name resolution>";
  const timeout = "Command timed out after 60000ms and terminated its process group.";
  const sabr = "ERROR: [youtube] j4YdbIbEc9E: Requested format is not available. Use --list-formats for a list of available formats";
  type Asset = { id: string; sourceId: string; title: string; playbackProbeFailures: number; playbackProbeError: string };
  const asset = (id: string, sourceId = YOUTUBE, failures = 0): Asset => ({
    id,
    sourceId,
    title: id,
    playbackProbeFailures: failures,
    playbackProbeError: failures > 0 ? dns : ""
  });
  const failed = (probed: Asset, error: string, pendingDownload = false): QueueProbeOutcome<Asset> => ({
    asset: probed,
    outcome: "failed",
    error,
    pendingDownload
  });
  const ok = (probed: Asset): QueueProbeOutcome<Asset> => ({ asset: probed, outcome: "ok", error: "" });
  // The two counters exactly as runPlayoutCycle feeds them from the one list.
  const quarantinePlan = (counted: QueueProbeOutcome<Asset>[], minutes = 0) =>
    planAssetProbeUpdates(
      counted.map((probed) => ({
        assetId: probed.asset.id,
        sourceId: probed.asset.sourceId,
        title: probed.asset.title,
        outcome: probed.outcome,
        error: probed.error,
        current: { playbackProbeFailures: probed.asset.playbackProbeFailures, playbackProbeError: probed.asset.playbackProbeError }
      })),
      at(minutes)
    );
  const breakerPlan = (records: SourceBreakerRecord[], counted: QueueProbeOutcome<Asset>[], minutes = 0) =>
    planSourceBreakerUpdates(records, sourceBreakerOutcomesOf(counted), at(minutes));

  it("finds the network-looking failures, and nothing to ask about without one", () => {
    const scan = [ok(asset("t1", TWITCH)), failed(asset("y1"), sabr), failed(asset("y2"), dns), failed(asset("y3"), timeout)];
    expect(networkLookingFailuresOf(scan).map((entry) => [entry.probed.asset.id, entry.reason])).toEqual([
      ["y2", "dns"],
      ["y3", "timeout"]
    ]);
    expect(networkLookingFailuresOf([ok(asset("t1", TWITCH)), failed(asset("y1"), sabr)])).toEqual([]);
  });

  it("counts a corroborated network failure in neither: three items of a single-source queue, at two failures each", () => {
    // The single-source case M75 could not guard: three remote items of one source, each one probe away
    // from quarantine, all failing while the way out is down.
    const scan = [failed(asset("y1", YOUTUBE, 2), dns), failed(asset("y2", YOUTUBE, 2), timeout), failed(asset("y3", YOUTUBE, 2), dns)];
    const { counted, uncounted } = withoutNetworkOutageOutcomes(scan, true);
    expect(counted).toEqual([]);
    expect(uncounted.map((entry) => entry.reason)).toEqual(["dns", "timeout", "dns"]);
    const quarantine = quarantinePlan(counted);
    expect(quarantine.updates).toEqual([]);
    expect(quarantine.crossed).toEqual([]);
    expect(breakerPlan([], counted)).toEqual({ updates: [], transitions: [] });

    // The same scan with the publish host reachable: counted exactly as before M82.
    const before = withoutNetworkOutageOutcomes(scan, false);
    expect(before.counted).toEqual(scan);
    expect(before.uncounted).toEqual([]);
    expect(quarantinePlan(before.counted).crossed.map((entry) => [entry.assetId, entry.failures])).toEqual([
      ["y1", ASSET_PROBE_QUARANTINE_THRESHOLD],
      ["y2", ASSET_PROBE_QUARANTINE_THRESHOLD],
      ["y3", ASSET_PROBE_QUARANTINE_THRESHOLD]
    ]);
    expect(breakerPlan([], before.counted).transitions.map((transition) => transition.kind)).toEqual(["opened"]);
  });

  it("is not a success either: counters keep their value and failures before the outage still add up", () => {
    const y1 = asset("y1", YOUTUBE, 2);
    const { counted } = withoutNetworkOutageOutcomes([failed(y1, dns)], true);
    // Nothing written: the item stays at two failures, neither quarantined nor cleared.
    expect(quarantinePlan(counted).updates).toEqual([]);

    // Two items failed for real before the blip; the outage's failure neither opens the breaker nor
    // forgets them, and the third real failure after it does open it.
    let records = breakerPlan([], [failed(asset("y1"), sabr), failed(asset("y2"), sabr)]).updates;
    expect(records[0]).toMatchObject({ state: "closed", failedAssetIds: ["y1", "y2"] });
    const during = breakerPlan(records, withoutNetworkOutageOutcomes([failed(asset("y3"), dns)], true).counted, 1);
    expect(during).toEqual({ updates: [], transitions: [] });
    records = breakerPlan(records, [failed(asset("y3"), sabr)], 6).updates;
    expect(records[0]).toMatchObject({ state: "open", failedAssetIds: ["y1", "y2", "y3"] });
  });

  it("leaves a half-open breaker as it is: the trial neither re-opens it with a doubled cooldown nor closes it", () => {
    const open = breakerPlan([], [failed(asset("y1"), sabr), failed(asset("y2"), sabr), failed(asset("y3"), sabr)]).updates;
    expect(open[0]).toMatchObject({ state: "open", cooldownSeconds: 1800 });
    const trialAt = Date.parse(at(31));
    expect(sourceBreakerPhase(open[0], trialAt)).toBe("half-open");

    const trial = [failed(asset("y4"), dns)];
    expect(breakerPlan(open, withoutNetworkOutageOutcomes(trial, true).counted, 31)).toEqual({ updates: [], transitions: [] });
    // The trial stays available: the next pick from the source is one item again.
    expect(sourceBreakerGate(open, trialAt + 60_000)).toEqual({ heldSourceIds: [], trialSourceIds: [YOUTUBE] });

    // Without the outage the same failure re-opens it for twice as long, as before.
    const reopened = breakerPlan(open, withoutNetworkOutageOutcomes(trial, false).counted, 31);
    expect(reopened.transitions.map((transition) => transition.kind)).toEqual(["reopened"]);
    expect(reopened.updates[0]).toMatchObject({ state: "open", cooldownSeconds: 3600 });
  });

  it("still counts every other error during an outage, and every clean probe", () => {
    const scan = [failed(asset("y1"), sabr), failed(asset("y2"), dns), ok(asset("t1", TWITCH, 2)), failed(asset("y3"), "HTTP Error 403: Forbidden")];
    const { counted, uncounted } = withoutNetworkOutageOutcomes(scan, true);
    expect(counted.map((probed) => probed.asset.id)).toEqual(["y1", "t1", "y3"]);
    expect(uncounted.map((entry) => entry.probed.asset.id)).toEqual(["y2"]);
    const quarantine = quarantinePlan(counted);
    expect(quarantine.updates.map((update) => [update.id, update.playbackProbeFailures])).toEqual([
      ["y1", 1],
      ["t1", 0],
      ["y3", 1]
    ]);
  });

  it("keeps the pending-download rule: the breaker does not hear it, quarantine does, outage or not", () => {
    const notCachedYet = "Twitch VOD cache is missing: Twitch VOD is not cached yet.";
    const scan = [failed(asset("t1", TWITCH), notCachedYet, true), failed(asset("t2", TWITCH), dns)];
    for (const outage of [true, false]) {
      const { counted } = withoutNetworkOutageOutcomes(scan, outage);
      expect(counted.map((probed) => probed.asset.id)).toEqual(outage ? ["t1"] : ["t1", "t2"]);
      expect(sourceBreakerOutcomesOf(counted).map((outcome) => outcome.assetId)).toEqual(outage ? [] : ["t2"]);
      expect(quarantinePlan(counted).updates.map((update) => update.id)).toEqual(outage ? ["t1"] : ["t1", "t2"]);
    }
  });
});

// The worker module starts the playout on import, so its wiring is checked in its source.
describe("network outage wiring", () => {
  const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
  const flat = (text: string) => text.replace(/\s+/g, " ");
  const flatWorker = flat(workerSource);
  const bodyOf = (signature: string) => {
    const start = workerSource.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    const rest = workerSource.slice(start + signature.length);
    const end = rest.search(/\n(?:export )?(?:async )?function /);
    return flat(workerSource.slice(start, end === -1 ? undefined : start + signature.length + end));
  };

  it("feeds quarantine and the breaker from one list, the scan's outcomes minus the outage's", () => {
    const filtered = flatWorker.indexOf('const probeOutcomes = await dropNetworkOutageOutcomes(scannedProbeOutcomes, "queue");');
    const quarantine = flatWorker.indexOf("const probePlan = planAssetProbeUpdates( probeOutcomes.map((probed) => ({");
    const breaker = flatWorker.indexOf("heldSources = await applySourceBreakerOutcomes({ state, probeOutcomes, quarantinedBySource });");
    expect(filtered).toBeGreaterThan(-1);
    expect(quarantine).toBeGreaterThan(filtered);
    expect(breaker).toBeGreaterThan(quarantine);
    // The raw scan result is read nowhere else: no counter can take the unfiltered list by mistake.
    expect(flatWorker.match(/scannedProbeOutcomes/g)).toHaveLength(2);
    expect(flatWorker).toContain("probeOutcomes: scannedProbeOutcomes, scannedSourceIds, deferredExpensive } = await getPlayableQueuedAssets(");
  });

  it("filters the inline resolve of the selection the same way, before the pending-download rule", () => {
    const selection = bodyOf("async function recordSelectionResolveOutcome(");
    expect(selection).toContain("const outcomes = sourceBreakerOutcomesOf( await dropNetworkOutageOutcomes( [ { asset, outcome,");
    expect(selection).toContain('pendingDownload: error instanceof TwitchVodCachePendingError } ], "selection" ) );');
    expect(selection).toContain("if (outcomes.length === 0) { return null; }");
  });

  it("asks only when a network-looking failure is about to be counted, and never throws", () => {
    const drop = bodyOf("async function dropNetworkOutageOutcomes<");
    const guard = drop.indexOf("if (networkLookingFailuresOf(probeOutcomes).length === 0) { return probeOutcomes; }");
    const asked = drop.indexOf("const verdict = await networkOutageCheck(latestPublishHostTargets);");
    expect(guard).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(guard);
    expect(drop).toContain("const { counted, uncounted } = withoutNetworkOutageOutcomes(probeOutcomes, verdict.outage);");
    // A check that breaks counts everything, as before M82.
    expect(drop).toContain("} catch (checkError) {");
    expect(drop.slice(drop.indexOf("} catch (checkError) {"))).toContain("return probeOutcomes;");
  });

  // The check swallows its own failure into "no outage" (so it cannot reject), which left the event below
  // unreachable: a broken check counted an outage against the content without a line (M82 review).
  it("says so when the check itself broke, before anything is taken out, through a limiter of its own", () => {
    const drop = bodyOf("async function dropNetworkOutageOutcomes<");
    const asked = drop.indexOf("const verdict = await networkOutageCheck(latestPublishHostTargets);");
    const flagged = drop.indexOf("if (verdict.checkFailed) { logNetworkOutageCheckFailed(verdict.evidence); return probeOutcomes; }");
    const filtered = drop.indexOf("withoutNetworkOutageOutcomes(probeOutcomes, verdict.outage)");
    expect(asked).toBeGreaterThan(-1);
    expect(flagged).toBeGreaterThan(asked);
    expect(filtered).toBeGreaterThan(flagged);
    expect(drop.slice(drop.indexOf("} catch (checkError) {"))).toContain(
      "logNetworkOutageCheckFailed(checkError instanceof Error ? checkError.message : String(checkError)); return probeOutcomes;"
    );

    const log = bodyOf("function logNetworkOutageCheckFailed(");
    expect(log).toContain('const unlogged = probeOutageCheckFailedLog.take("check", Date.now()); if (unlogged === null) { return; }');
    expect(log).toContain('logRuntimeEvent("playout.probe.network_outage.check_failed", { error: error.slice(0, 300), unloggedSinceLastLine: unlogged });');
    // The event is written in that one place.
    expect(flatWorker.match(/playout\.probe\.network_outage\.check_failed/g)).toHaveLength(1);
    expect(flatWorker).toContain("const probeOutageCheckFailedLog = new ProbeOutageLogLimiter();");
  });

  it("lets an outage the check saw stand for the length of one resolve", () => {
    expect(flatWorker).toContain("const networkOutageCheck = createNetworkOutageCheck({ graceMs: PLAYABLE_INPUT_RESOLVE_TIMEOUT_MS });");
  });

  it("logs each uncounted outcome through the limiter, with the item, the source, the reason and the evidence", () => {
    const drop = bodyOf("async function dropNetworkOutageOutcomes<");
    expect(drop).toContain("const unlogged = probeOutageLog.take(probed.asset.id, Date.now()); if (unlogged === null) { continue; }");
    expect(drop).toContain(
      'logRuntimeEvent("playout.probe.network_outage", { assetId: probed.asset.id, sourceId: probed.asset.sourceId, path, reason, corroboration: verdict.evidence,'
    );
    expect(drop).toContain("unloggedSinceLastLine: unlogged");
  });

  it("asks the outputs the channel publishes to, refreshed by every playout cycle, not the local relay", () => {
    expect(bodyOf("async function runPlayoutCycle(")).toContain(
      "latestManagedConfig = state.managedConfig; latestPublishHostTargets = publishHostTargetsOfDestinations(state.destinations);"
    );
    const targets = bodyOf("function publishHostTargetsOfDestinations(");
    expect(targets).toContain(".filter((destination) => destination.enabled)");
    expect(targets).toContain("destination.rtmpUrl || getLegacyDestinationEnvConfig(destination.id, process.env).url");
    expect(targets).not.toContain("getRelay");
  });
});
