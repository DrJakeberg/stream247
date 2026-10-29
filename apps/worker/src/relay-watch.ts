// The relay is watched from outside (M114, R3's optional part of H8).
//
// The relay image (bluenviron/mediamtx, pinned) holds nothing but the mediamtx binary: no shell and
// no HTTP client, so Compose cannot run a healthcheck inside it, and the pin stays as it is. A crash
// is already covered by `restart: unless-stopped`; what nobody saw was a relay that runs but stops
// answering. The worker now asks the relay's container-internal API every cycle and raises the
// incident `relay.unreachable` once it has not answered for `RELAY_UNREACHABLE_AFTER_MS` in a row;
// the incident closes on the first answer again.
//
// Only while something uses the relay: relay mode with the uplink reading the programme from it
// (uplink input `rtmp`) or live sources (cameras publish into it). Otherwise a stopped relay takes
// neither the programme nor a live attach off the air. Program-feed mode (M126) is relay mode with the
// default uplink input `hls`: the playout writes HLS and the uplink reads that playlist, so no programme
// passes through the relay.

import type { UplinkInputMode } from "./ffmpeg-runtime.js";

export const RELAY_UNREACHABLE_AFTER_MS = 2 * 60_000;
export const RELAY_API_TIMEOUT_MS = 5_000;
export const RELAY_UNREACHABLE_FINGERPRINT = "relay.unreachable";
export const RELAY_API_BASE_URL = "http://relay:9997";

export type RelayWatchAction =
  | { action: "none" }
  | { action: "raise"; unreachableForMs: number }
  | { action: "resolve" };

export class RelayWatch {
  private unreachableSinceMs: number | null = null;

  /** `incidentOpen`: an earlier process left `relay.unreachable` open (M95's re-arm idea). */
  constructor(
    private incidentOpen: boolean = false,
    private readonly unreachableAfterMs: number = RELAY_UNREACHABLE_AFTER_MS
  ) {}

  observe(reachable: boolean, nowMs: number): RelayWatchAction {
    if (reachable) {
      this.unreachableSinceMs = null;
      if (this.incidentOpen) {
        this.incidentOpen = false;
        return { action: "resolve" };
      }
      return { action: "none" };
    }
    if (this.unreachableSinceMs === null || nowMs < this.unreachableSinceMs) {
      this.unreachableSinceMs = nowMs;
    }
    const unreachableForMs = nowMs - this.unreachableSinceMs;
    if (!this.incidentOpen && unreachableForMs >= this.unreachableAfterMs) {
      this.incidentOpen = true;
      return { action: "raise", unreachableForMs };
    }
    return { action: "none" };
  }

  /** Nothing uses the relay any more: forget the streak, and close what is open. */
  idle(): RelayWatchAction {
    this.unreachableSinceMs = null;
    if (this.incidentOpen) {
      this.incidentOpen = false;
      return { action: "resolve" };
    }
    return { action: "none" };
  }

  /** One worker cycle (M126): the API is asked only while something uses the relay, else the watch idles. */
  async cycle(
    inUse: boolean,
    probe: () => Promise<boolean>,
    now: () => number = Date.now
  ): Promise<RelayWatchAction> {
    return inUse ? this.observe(await probe(), now()) : this.idle();
  }
}

/** `uplinkInputMode` as `getUplinkInputMode` normalises it: anything but `rtmp` is `hls`. */
export function relayInUse(args: {
  relayModeEnabled: boolean;
  uplinkInputMode: UplinkInputMode;
  sourceLiveEnabled: boolean;
}): boolean {
  return (args.relayModeEnabled && args.uplinkInputMode === "rtmp") || args.sourceLiveEnabled;
}

/**
 * True when the relay's API answers at all. Any HTTP answer counts, even an error status: the
 * question is whether the relay process still serves, not whether a path exists.
 */
export async function isRelayApiReachable(args: {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
} = {}): Promise<boolean> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? RELAY_API_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${args.baseUrl ?? RELAY_API_BASE_URL}/v3/paths/list?itemsPerPage=1`, {
      signal: controller.signal
    });
    await response.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function relayUnreachableMessage(unreachableForMs: number): string {
  return `The relay has not answered on its API (${RELAY_API_BASE_URL}) for ${Math.round(unreachableForMs / 1000)}s. With the relay on, the uplink reads the programme from it and live sources publish into it, so viewers may see the stream stop. This incident closes by itself once the relay answers again.`;
}
