// M87: an external failure costs one step, not the cycle (R3 H1 and H6, owner Q3).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { opensIncident } from "../../apps/worker/src/alerts.js";
import {
  CYCLE_STEP_ALERT_AFTER_MS,
  CycleStepAlertWatch,
  CycleStepIncidentTracker,
  runIsolatedCycleSteps,
  type CycleStep
} from "../../apps/worker/src/cycle-steps.js";
import { EXTERNAL_REQUEST_TIMEOUT_MS, fetchWithTimeout } from "../../apps/worker/src/http-timeout.js";
import {
  TWITCH_REFRESH_REFUSED_ERROR,
  TwitchTokenRefreshError,
  isIdentityRefreshRefusal,
  isRefusedRefreshResponse,
  requestTwitchTokenRefresh
} from "../../apps/worker/src/twitch-token-refresh.js";
import { decideTwitchConnectionHeal } from "../../apps/worker/src/twitch-connection-heal.js";

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");

/** A fetch that accepts the request and never answers; like a real fetch it honours the signal. */
function neverAnsweringFetch(): (url: string, init?: RequestInit) => Promise<Response> {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
}

describe("worker cycle steps (H1)", () => {
  it("runs the heartbeat and the sweep after a Twitch refresh that throws", async () => {
    const ran: string[] = [];
    const failures: Array<{ name: string; message: string }> = [];
    const steps: CycleStep[] = [
      { name: "asset-retention", run: async () => void ran.push("asset-retention") },
      {
        name: "twitch-sync",
        run: async () => {
          throw new TwitchTokenRefreshError("Twitch token refresh failed with status 400.", 400, true, "identity");
        }
      },
      { name: "twitch-live-status", run: async () => void ran.push("twitch-live-status") },
      { name: "chat", run: async () => void ran.push("chat") }
    ];

    const failed = await runIsolatedCycleSteps(steps, {
      onFailure: async (name, error) => void failures.push({ name, message: (error as Error).message }),
      onSuccess: async () => {}
    });
    // What runWorkerCycle does after the steps; reached only when runIsolatedCycleSteps resolves.
    ran.push("heartbeat", "incident-sweep");

    expect(failed).toEqual(["twitch-sync"]);
    expect(failures).toEqual([{ name: "twitch-sync", message: "Twitch token refresh failed with status 400." }]);
    expect(ran).toEqual(["asset-retention", "twitch-live-status", "chat", "heartbeat", "incident-sweep"]);
  });

  it("ends the cycle when the failure cannot be recorded (database gone, M86 path)", async () => {
    const ran: string[] = [];
    const cycle = runIsolatedCycleSteps(
      [
        {
          name: "destinations",
          run: async () => {
            throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
          }
        },
        { name: "local-library", run: async () => void ran.push("local-library") }
      ],
      {
        onFailure: async (_name, error) => {
          throw error;
        },
        onSuccess: async () => {}
      }
    );

    await expect(cycle).rejects.toThrow("ECONNREFUSED");
    expect(ran).toEqual([]);
  });

  it("closes a step's incident once per process and again only after it failed", () => {
    const tracker = new CycleStepIncidentTracker();
    expect(tracker.needsResolve("twitch-sync")).toBe(true);
    tracker.markResolved("twitch-sync");
    expect(tracker.needsResolve("twitch-sync")).toBe(false);
    tracker.markFailed("twitch-sync");
    expect(tracker.needsResolve("twitch-sync")).toBe(true);
  });

  it("runWorkerCycle isolates its steps and writes the heartbeat after them", () => {
    const start = workerSource.indexOf("async function runWorkerCycle(): Promise<void> {");
    const body = workerSource.slice(start, workerSource.indexOf("\n}\n", start));
    const isolated = body.indexOf("runIsolatedCycleSteps(buildWorkerCycleSteps()");
    const heartbeat = body.indexOf("workerHeartbeatAt: new Date().toISOString()");
    const sweep = body.indexOf("resolveFinishedIncidents(");
    expect(isolated).toBeGreaterThan(-1);
    expect(heartbeat).toBeGreaterThan(isolated);
    expect(sweep).toBeGreaterThan(heartbeat);

    const stepsStart = workerSource.indexOf("function buildWorkerCycleSteps(): CycleStep[] {");
    const steps = workerSource.slice(stepsStart, workerSource.indexOf("\n}\n", stepsStart));
    for (const step of ["reconcileTwitch", "reconcileTwitchLiveStatus", "reconcileTwitchEventSub", "twitchChatBridge.sync", "syncTwitchVodSources"]) {
      expect(steps, step).toContain(step);
    }
  });
});

// Review finding R2 (fixed in M105): isolating the steps took away the alert a crashing cycle sent.
describe("a failure that lasts still reaches the operator's alert channel (R2)", () => {
  it("alerts a step that has failed on every run for 30 min, then every 30 min while it lasts", () => {
    const watch = new CycleStepAlertWatch();
    const t0 = Date.parse("2026-10-05T00:00:00.000Z");
    const alerts: number[] = [];
    // One failed run every 30 s for 75 minutes.
    for (let ms = 0; ms <= 75 * 60_000; ms += 30_000) {
      const failingFor = watch.recordFailure("twitch-sync", t0 + ms);
      if (failingFor !== null) {
        alerts.push(failingFor / 60_000);
      }
    }
    expect(CYCLE_STEP_ALERT_AFTER_MS).toBe(30 * 60_000);
    expect(alerts).toEqual([30, 60]);
  });

  it("does not alert a short failure, nor one a success interrupts, and keeps steps apart", () => {
    const watch = new CycleStepAlertWatch();
    const t0 = Date.parse("2026-10-05T00:00:00.000Z");
    for (let ms = 0; ms < 3 * 3_600_000; ms += 30_000) {
      // A source host down for 20 minutes of every hour: each streak ends before the bound.
      if (ms % 3_600_000 < 20 * 60_000) {
        expect(watch.recordFailure("youtube-sources", t0 + ms)).toBeNull();
      } else {
        watch.recordSuccess("youtube-sources");
      }
    }
    expect(watch.recordFailure("twitch-sync", t0)).toBeNull();
    expect(watch.recordFailure("twitch-sync", t0 + CYCLE_STEP_ALERT_AFTER_MS)).toBe(CYCLE_STEP_ALERT_AFTER_MS);
  });

  it("alerts a refused Twitch token when its reconnect entry opens, not on every refusal after", () => {
    expect(opensIncident([], "twitch.reconnect.required")).toBe(true);
    expect(opensIncident([{ fingerprint: "twitch.reconnect.required", status: "resolved" }], "twitch.reconnect.required")).toBe(true);
    expect(opensIncident([{ fingerprint: "twitch.reconnect.required", status: "open" }], "twitch.reconnect.required")).toBe(false);
  });

  it("is what the worker does with them (index.ts cannot be imported: it starts the worker)", () => {
    const refused = workerSource.slice(workerSource.indexOf("async function markIdentityRefreshRefused("), workerSource.indexOf("async function closeTwitchReconnectIncident("));
    // The check reads the incidents before the entry is written, and the alert follows the write.
    expect(refused.indexOf('const opening = opensIncident(state.incidents, "twitch.reconnect.required");')).toBeGreaterThan(-1);
    expect(refused.indexOf("const opening")).toBeLessThan(refused.indexOf("await upsertIncident({"));
    expect(refused.indexOf('await sendAlert("Reconnect Twitch", message)')).toBeGreaterThan(refused.indexOf("await upsertIncident({"));
    // One refused token, one alert (review of M105): the 401 retries of reconciliation and schedule sync,
    // which have alerts of their own, leave theirs out when the refusal is the bot's refused token.
    expect(refused).toContain("async function markIdentityRefreshRefused(error: unknown): Promise<boolean> {");
    expect(refused).toContain("if (!isIdentityRefreshRefusal(error)) {\n    return false;\n  }");
    expect(refused.indexOf("  return true;\n}")).toBeGreaterThan(refused.indexOf('await sendAlert("Reconnect Twitch", message)'));
    const flatWorker = workerSource.replace(/\s+/g, " ");
    for (const subject of ["Twitch reconciliation warning", "Twitch schedule sync warning"]) {
      expect(flatWorker, subject).toContain(`if (!refused) { await sendAlert("${subject}", refreshMessage); }`);
    }
    expect(flatWorker.match(/const refused = await markIdentityRefreshRefused\(refreshError\);/g)?.length).toBe(2);
    const failed = workerSource.slice(workerSource.indexOf("async function recordWorkerCycleStepFailure("), workerSource.indexOf("async function runWorkerCycle("));
    // After the incident write, so a database outage (which rethrows above) alerts nothing; a success resets.
    expect(failed.indexOf("workerCycleStepAlerts.recordFailure(step, Date.now())")).toBeGreaterThan(failed.indexOf("throw error;"));
    expect(failed).toContain("workerCycleStepAlerts.recordSuccess(step);");
  });
});

describe("Twitch refresh failures (H1, owner Q3)", () => {
  it("counts invalid_grant and Twitch's own 'Invalid refresh token' as a refused token", () => {
    expect(isRefusedRefreshResponse(400, '{"error":"invalid_grant","error_description":"Invalid refresh token"}')).toBe(true);
    expect(isRefusedRefreshResponse(400, '{"status":400,"message":"Invalid refresh token"}')).toBe(true);
  });

  it("does not count an outage, a rate limit or a client-credential error as a refused token", () => {
    expect(isRefusedRefreshResponse(503, "Service Unavailable")).toBe(false);
    expect(isRefusedRefreshResponse(429, '{"error":"invalid_grant"}')).toBe(false);
    expect(isRefusedRefreshResponse(400, '{"status":400,"message":"invalid client"}')).toBe(false);
  });

  it("throws a refused TwitchTokenRefreshError on HTTP 400 invalid_grant", async () => {
    const refresh = requestTwitchTokenRefresh({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "dead",
      errorLabel: "Twitch token refresh",
      account: "identity",
      fetchImpl: async () => new Response('{"error":"invalid_grant"}', { status: 400 })
    });
    const error = await refresh.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TwitchTokenRefreshError);
    expect((error as TwitchTokenRefreshError).refused).toBe(true);
    expect((error as TwitchTokenRefreshError).status).toBe(400);
    expect((error as TwitchTokenRefreshError).account).toBe("identity");
  });

  it("puts only the bot account into error, never for the broadcast channel account's refusal", () => {
    expect(isIdentityRefreshRefusal(new TwitchTokenRefreshError("x", 400, true, "identity"))).toBe(true);
    // Split mode: a 401 retry refreshes both; the bot's refresh worked, the channel owner's was refused.
    expect(isIdentityRefreshRefusal(new TwitchTokenRefreshError("x", 400, true, "broadcaster"))).toBe(false);
    expect(isIdentityRefreshRefusal(new TwitchTokenRefreshError("x", 503, false, "identity"))).toBe(false);
    expect(isIdentityRefreshRefusal(new Error("Twitch token refresh failed with status 400."))).toBe(false);
  });

  it("throws a transient TwitchTokenRefreshError on HTTP 503", async () => {
    const error = await requestTwitchTokenRefresh({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "fine",
      errorLabel: "Twitch token refresh",
      account: "identity",
      fetchImpl: async () => new Response("down", { status: 503 })
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TwitchTokenRefreshError);
    expect((error as TwitchTokenRefreshError).refused).toBe(false);
  });

  it("gives up on a token endpoint that never answers", async () => {
    const startedAt = Date.now();
    await expect(
      requestTwitchTokenRefresh({
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "fine",
        errorLabel: "Twitch token refresh",
      account: "identity",
        fetchImpl: neverAnsweringFetch(),
        timeoutMs: 200
      })
    ).rejects.toThrow("https://id.twitch.tv/oauth2/token did not answer within 200 ms.");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("the heal leaves a refused connection for the operator to reconnect", () => {
    expect(
      decideTwitchConnectionHeal({
        status: "error",
        accessToken: "still-valid-for-minutes",
        error: TWITCH_REFRESH_REFUSED_ERROR,
        lastAttemptAt: 0,
        now: 60 * 60_000
      })
    ).toEqual({ attempt: false, reason: "refresh-refused" });
    expect(
      decideTwitchConnectionHeal({
        status: "error",
        accessToken: "stored",
        error: "Some other failure.",
        lastAttemptAt: 0,
        now: 60 * 60_000
      })
    ).toEqual({ attempt: true });
  });
});

describe("timeouts on external calls (H6)", () => {
  it("aborts a fetch that never answers within its timeout", async () => {
    const startedAt = Date.now();
    await expect(
      fetchWithTimeout("https://api.twitch.tv/helix/channels?broadcaster_id=1", {}, { fetchImpl: neverAnsweringFetch(), timeoutMs: 150 })
    ).rejects.toThrow("https://api.twitch.tv/helix/channels did not answer within 150 ms.");
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("releases the caller even when the fetch ignores the signal", async () => {
    const startedAt = Date.now();
    await expect(
      fetchWithTimeout("https://api.twitch.tv/helix/users", {}, { fetchImpl: () => new Promise<Response>(() => {}), timeoutMs: 150 })
    ).rejects.toThrow("did not answer within 150 ms");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("does not put a webhook token from the path into the timeout message", async () => {
    const error = await fetchWithTimeout(
      "https://discord.com/api/webhooks/123/secret-token",
      {},
      { fetchImpl: neverAnsweringFetch(), timeoutMs: 50 }
    ).catch((caught: unknown) => caught as Error);
    expect(error.message).toBe("https://discord.com did not answer within 50 ms.");
  });

  it("passes an answer through and keeps other errors as they are", async () => {
    const response = await fetchWithTimeout("https://api.twitch.tv/helix/users", {}, { fetchImpl: async () => new Response("ok") });
    expect(await response.text()).toBe("ok");
    await expect(
      fetchWithTimeout("https://api.twitch.tv/helix/users", {}, {
        fetchImpl: async () => {
          throw new Error("getaddrinfo ENOTFOUND api.twitch.tv");
        }
      })
    ).rejects.toThrow("ENOTFOUND");
    expect(EXTERNAL_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it("no worker fetch runs without a deadline", () => {
    // The six Twitch requests R3 counted in the worker cycle all go through fetchWithTimeout.
    expect(workerSource.match(/fetchWithTimeout\(/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(workerSource).not.toMatch(/[^.\w]fetch\(/);
    for (const file of ["twitch-eventsub.ts", "twitch-broadcast-channel.ts", "twitch-token-refresh.ts", "alerts.ts"]) {
      const source = readFileSync(path.join(process.cwd(), "apps/worker/src", file), "utf8");
      expect(source, file).toContain("fetchWithTimeout(");
    }
    // The channel owner's scope check reads id.twitch.tv through core's validate helper.
    expect(workerSource).toMatch(/readChannelOwnerScopes\([^;]*fetchWithTimeout/);
    const heal = readFileSync(path.join(process.cwd(), "apps/worker/src/twitch-connection-heal.ts"), "utf8");
    expect(heal).toContain("signal: AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS)");
  });

  it("every yt-dlp and ffprobe call of the worker carries timeoutMs", () => {
    const calls = [...workerSource.matchAll(/execFileText\(/g)].map((match) => {
      // The call's text up to its closing parenthesis.
      let depth = 0;
      let index = (match.index ?? 0) + "execFileText".length;
      const begin = index;
      for (; index < workerSource.length; index += 1) {
        const char = workerSource[index];
        if (char === "(") depth += 1;
        if (char === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      return workerSource.slice(begin, index + 1);
    });
    // The import line is not a call.
    const realCalls = calls.filter((call) => call.includes(","));
    expect(realCalls.length).toBeGreaterThanOrEqual(6);
    for (const call of realCalls) {
      expect(call, call).toContain("timeoutMs");
    }
  });
});
