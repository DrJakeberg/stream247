import { describe, expect, it } from "vitest";
import {
  ATTACH_FAILURE_COOLDOWN_MS,
  attachBreakerRemainingMs,
  closedAttachBreaker,
  decideSourceLiveAttach,
  fetchRelaySourcePresence,
  isAttachBreakerOpen,
  openAttachBreaker
} from "../../apps/worker/src/relay-presence.js";

// M57 stage 2, Etappe B: the attach decision is computed and logged, never acted on. The
// decision function is I/O-free so this matrix can pin every branch, and every uncertain input
// (failed presence fetch, open breaker) resolves to "skip" — the fail-safe direction is stage 1,
// where the snapshot sampler keeps drawing the panel.

const NOW = 1_756_300_000_000;

function baseInput() {
  return {
    sourceLiveEnabled: true,
    sourceLayerEnabled: true,
    sourceId: "studio-cam",
    presence: { publishing: true },
    breaker: closedAttachBreaker(),
    nowMs: NOW
  };
}

describe("source live attach decision", () => {
  it("attaches only when every gate is green", () => {
    expect(decideSourceLiveAttach(baseInput())).toEqual({ decision: "attach", reason: "publishing" });
  });

  it("skips when either switch is off, before anything else is consulted", () => {
    expect(decideSourceLiveAttach({ ...baseInput(), sourceLiveEnabled: false })).toEqual({
      decision: "skip",
      reason: "switched-off"
    });
    expect(decideSourceLiveAttach({ ...baseInput(), sourceLayerEnabled: false })).toEqual({
      decision: "skip",
      reason: "switched-off"
    });
  });

  it("skips without a source layer in the scene", () => {
    expect(decideSourceLiveAttach({ ...baseInput(), sourceId: "" })).toEqual({
      decision: "skip",
      reason: "no-source-layer"
    });
  });

  it("skips while the breaker cools down after a failed attach", () => {
    const breaker = openAttachBreaker(NOW - 1);
    expect(decideSourceLiveAttach({ ...baseInput(), breaker })).toEqual({
      decision: "skip",
      reason: "breaker-cooldown"
    });
  });

  it("fails safe when presence is unknown, and skips a source that is not publishing", () => {
    expect(decideSourceLiveAttach({ ...baseInput(), presence: null })).toEqual({
      decision: "skip",
      reason: "presence-unknown"
    });
    expect(decideSourceLiveAttach({ ...baseInput(), presence: { publishing: false } })).toEqual({
      decision: "skip",
      reason: "not-publishing"
    });
  });
});

describe("attach circuit breaker", () => {
  it("holds for the whole cooldown window and no longer", () => {
    const opened = openAttachBreaker(NOW);
    expect(isAttachBreakerOpen(opened, NOW)).toBe(true);
    expect(isAttachBreakerOpen(opened, NOW + ATTACH_FAILURE_COOLDOWN_MS - 1)).toBe(true);
    expect(isAttachBreakerOpen(opened, NOW + ATTACH_FAILURE_COOLDOWN_MS)).toBe(false);
    expect(ATTACH_FAILURE_COOLDOWN_MS).toBe(3 * 60_000);
  });

  it("starts closed and reports its remaining time", () => {
    expect(isAttachBreakerOpen(closedAttachBreaker(), NOW)).toBe(false);
    expect(attachBreakerRemainingMs(closedAttachBreaker(), NOW)).toBe(0);
    const opened = openAttachBreaker(NOW);
    expect(attachBreakerRemainingMs(opened, NOW + 60_000)).toBe(ATTACH_FAILURE_COOLDOWN_MS - 60_000);
    expect(attachBreakerRemainingMs(opened, NOW + ATTACH_FAILURE_COOLDOWN_MS + 5)).toBe(0);
  });
});

describe("relay presence fetch", () => {
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("asks the relay API for the source path and reads readiness", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return jsonResponse(200, { name: "src-studio-cam", ready: true });
    }) as typeof fetch;

    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl })).toEqual({ publishing: true });
    expect(seen).toEqual(["http://relay:9997/v3/paths/get/src-studio-cam"]);
  });

  it("treats a known-but-idle path and a missing path as not publishing", async () => {
    const idle = (async () => jsonResponse(200, { name: "src-studio-cam", ready: false })) as typeof fetch;
    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl: idle })).toEqual({ publishing: false });

    const missing = (async () => new Response(null, { status: 404 })) as typeof fetch;
    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl: missing })).toEqual({ publishing: false });
  });

  it("returns unknown on server errors, network failures and timeouts", async () => {
    const serverError = (async () => new Response(null, { status: 500 })) as typeof fetch;
    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl: serverError })).toBeNull();

    const network = (async () => {
      throw new Error("connect refused");
    }) as typeof fetch;
    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl: network })).toBeNull();

    // A hanging relay is bounded by the abort signal, far under the cycle budget.
    const hanging = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl: hanging, timeoutMs: 20 })).toBeNull();
  });
});
