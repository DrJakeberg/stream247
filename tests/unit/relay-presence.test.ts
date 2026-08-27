import { describe, expect, it } from "vitest";
import {
  ATTACH_FAILURE_COOLDOWN_MS,
  attachBreakerRemainingMs,
  buildSourceLiveStateWrite,
  closedAttachBreaker,
  decideSourceLiveAttach,
  fetchRelaySourcePresence,
  isAttachBreakerOpen,
  openAttachBreaker,
  relayTracksHaveAudio
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

// M57 stage 2, Etappe E: the same decision the worker logs is also projected to the operator, so
// the write it hands the store is pure and pinned here rather than buried in the playout cycle.
describe("what the attach decision leaves behind for the operator", () => {
  it("records the decision reason against the source it is about", () => {
    expect(
      buildSourceLiveStateWrite({
        sourceId: "studio-cam",
        outcome: { decision: "attach", reason: "publishing" },
        breaker: closedAttachBreaker(),
        nowMs: NOW
      })
    ).toEqual({ sourceId: "studio-cam", state: "publishing", retryAt: "" });
  });

  it("writes nothing when there is no source the state could belong to", () => {
    // "no-source-layer" is a statement about the scene, not about any stored source; attributing
    // it to one would leave a source claiming a state nobody decided about it.
    expect(
      buildSourceLiveStateWrite({
        sourceId: "",
        outcome: { decision: "skip", reason: "no-source-layer" },
        breaker: closedAttachBreaker(),
        nowMs: NOW
      })
    ).toBeNull();
  });

  it("carries the moment the cooldown ends, so the surface can count down instead of guessing", () => {
    const write = buildSourceLiveStateWrite({
      sourceId: "studio-cam",
      outcome: { decision: "skip", reason: "breaker-cooldown" },
      breaker: openAttachBreaker(NOW),
      nowMs: NOW + 30_000
    });

    expect(write?.state).toBe("breaker-cooldown");
    expect(write?.retryAt).toBe(new Date(NOW + ATTACH_FAILURE_COOLDOWN_MS).toISOString());
  });

  it("leaves the retry moment empty for every state that is not a cooldown", () => {
    for (const reason of ["switched-off", "not-publishing", "presence-unknown"] as const) {
      const write = buildSourceLiveStateWrite({
        sourceId: "studio-cam",
        outcome: { decision: "skip", reason },
        breaker: openAttachBreaker(NOW),
        nowMs: NOW + 30_000
      });
      expect(write?.retryAt, `${reason} should carry no countdown`).toBe("");
    }
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

    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl })).toEqual({ publishing: true, hasAudio: false });
    expect(seen).toEqual(["http://relay:9997/v3/paths/get/src-studio-cam"]);
  });

  it("reports an audio track from the path's codec list", async () => {
    const withAudio = (async () =>
      jsonResponse(200, { name: "src-studio-cam", ready: true, tracks: ["H264", "MPEG-4 Audio"] })) as typeof fetch;
    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl: withAudio })).toEqual({
      publishing: true,
      hasAudio: true
    });

    const videoOnly = (async () => jsonResponse(200, { name: "src-studio-cam", ready: true, tracks: ["H264"] })) as typeof fetch;
    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl: videoOnly })).toEqual({
      publishing: true,
      hasAudio: false
    });
  });

  it("treats a known-but-idle path and a missing path as not publishing", async () => {
    const idle = (async () => jsonResponse(200, { name: "src-studio-cam", ready: false })) as typeof fetch;
    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl: idle })).toEqual({ publishing: false, hasAudio: false });

    const missing = (async () => new Response(null, { status: 404 })) as typeof fetch;
    expect(await fetchRelaySourcePresence({ sourceId: "studio-cam", fetchImpl: missing })).toEqual({ publishing: false, hasAudio: false });
  });

  it("recognises common audio codecs and rejects video-only track lists", () => {
    for (const track of ["MPEG-4 Audio", "Opus", "G711", "G722", "LPCM", "MP3", "AC3", "Vorbis"]) {
      expect(relayTracksHaveAudio(["H264", track])).toBe(true);
    }
    expect(relayTracksHaveAudio(["H264", "H265", "VP9", "AV1"])).toBe(false);
    expect(relayTracksHaveAudio([])).toBe(false);
    expect(relayTracksHaveAudio(undefined)).toBe(false);
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
