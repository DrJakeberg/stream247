import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSeedState } from "@stream247/db";
import type { AppState } from "../../apps/web/lib/server/state";

/**
 * The public status JSON, GET /api/channel/live (M128).
 *
 * Anonymous and polled by every open /channel tab, so it answers from a shared cache of a few seconds
 * and limits each address, keyed like every other limit since M125 (the last X-Forwarded-For entry).
 * The operator's status text (playout.message) is not public, here nor on the SSE stream.
 */

const { mockReadAppState } = vi.hoisted(() => ({ mockReadAppState: vi.fn() }));

vi.mock("@/lib/server/state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/web/lib/server/state")>()),
  readAppState: mockReadAppState
}));

import { GET } from "../../apps/web/app/api/channel/live/route";
import { GET as streamGET } from "../../apps/web/app/api/channel/live/stream/route";
import { getPublicChannelSnapshot } from "../../apps/web/lib/server/state";
import { clearPublicChannelStatusCache } from "../../apps/web/lib/server/public-channel-status";
import { LOGIN_RATE_LIMIT, clearAllRateLimits, consumeRateLimit } from "../../apps/web/lib/server/rate-limit";

const START = Date.parse("2026-11-25T12:00:00.000Z");
const NOTE = "Operator note 42";

function seedState(): AppState {
  const state = createInitialSeedState();
  return { ...state, playout: { ...state.playout, message: NOTE } };
}

function request(forwardedFor: string) {
  return new Request("http://localhost/api/channel/live", { headers: { "x-forwarded-for": forwardedFor } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  clearPublicChannelStatusCache();
  clearAllRateLimits();
  mockReadAppState.mockReset();
  mockReadAppState.mockImplementation(async () => seedState());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/channel/live: the shared cache", () => {
  it("B1: reads the state once per five seconds for everyone, concurrent misses sharing one read", async () => {
    const read = deferred<AppState>();
    mockReadAppState.mockImplementationOnce(() => read.promise);

    const concurrent = Array.from({ length: 50 }, (_, i) => GET(request(`10.0.0.${i}`)));
    read.resolve(seedState());
    const responses = await Promise.all(concurrent);
    for (let i = 50; i < 100; i++) {
      vi.setSystemTime(START + (i - 50) * 100);
      responses.push(await GET(request(`10.0.1.${i}`)));
    }

    expect(mockReadAppState).toHaveBeenCalledTimes(1);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const bodies = await Promise.all(responses.map((response) => response.text()));
    expect(new Set(bodies).size).toBe(1);
    expect(responses[0].headers.get("content-type")).toContain("application/json");
    expect(responses[0].headers.get("cache-control")).toBe("public, max-age=5");

    vi.setSystemTime(START + 5_000);
    await GET(request("10.0.2.1"));
    expect(mockReadAppState).toHaveBeenCalledTimes(1);

    vi.setSystemTime(START + 5_001);
    await GET(request("10.0.2.2"));
    expect(mockReadAppState).toHaveBeenCalledTimes(2);
  });

  it("B6: does not cache a failed read and does not leak its text", async () => {
    const read = deferred<AppState>();
    mockReadAppState.mockImplementationOnce(() => read.promise);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const waiting = Array.from({ length: 5 }, (_, i) => GET(request(`10.1.0.${i}`)));
    read.reject(new Error("connect ECONNREFUSED postgres:5432 password=hunter2"));
    const failed = await Promise.all(waiting);

    expect(mockReadAppState).toHaveBeenCalledTimes(1);
    const bodies = await Promise.all(failed.map((response) => response.text()));
    for (const [index, response] of failed.entries()) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.parse(bodies[index])).toEqual({ message: "The channel status is unavailable right now." });
      expect(bodies[index]).not.toContain("ECONNREFUSED");
    }

    const next = await GET(request("10.1.0.9"));
    expect(mockReadAppState).toHaveBeenCalledTimes(2);
    expect(next.status).toBe(200);
    errorLog.mockRestore();
  });

  it("B6: a state read that throws at once is not stuck as the shared read", async () => {
    mockReadAppState.mockImplementationOnce(() => {
      throw new Error("synchronous failure");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await GET(request("10.1.1.1"))).status).toBe(503);
    expect((await GET(request("10.1.1.2"))).status).toBe(200);
    expect(mockReadAppState).toHaveBeenCalledTimes(2);
    errorLog.mockRestore();
  });
});

describe("GET /api/channel/live: the per-address limit", () => {
  it("B2: answers 429 to the 121st request in a minute, cached hits included, and only to that address", async () => {
    for (let i = 1; i <= 120; i++) {
      expect((await GET(request("203.0.113.7"))).status).toBe(200);
    }

    const limited = await GET(request("203.0.113.7"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(await limited.json()).toEqual({ message: "Too many requests. Try again shortly." });
    expect(mockReadAppState).toHaveBeenCalledTimes(1);

    expect((await GET(request("203.0.113.8"))).status).toBe(200);

    vi.setSystemTime(START + 60_000);
    expect((await GET(request("203.0.113.7"))).status).toBe(200);
  });

  it("B3: keys on the last X-Forwarded-For entry, so a rotated first entry buys nothing", async () => {
    for (let i = 1; i <= 120; i++) {
      expect((await GET(request(`198.51.100.${i}, 192.0.2.10`))).status).toBe(200);
    }
    expect((await GET(request("198.51.100.200, 192.0.2.10"))).status).toBe(429);
    expect((await GET(request("198.51.100.200, 192.0.2.11"))).status).toBe(200);
  });

  it("B7: a flood of addresses cannot evict the sign-in limiter's buckets", async () => {
    const loginKey = "login:owner@example.com:192.0.2.50";
    for (let i = 0; i < 10; i++) {
      consumeRateLimit(loginKey, LOGIN_RATE_LIMIT, START);
    }

    // Late in the sign-in window, so the login bucket expires before any of the new ones: on a shared
    // map it would be the first evicted.
    vi.setSystemTime(START + 14.5 * 60_000);
    for (let i = 0; i < 20_000; i++) {
      await GET(request(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`));
    }

    expect(consumeRateLimit(loginKey, LOGIN_RATE_LIMIT, Date.now()).allowed).toBe(false);
  }, 30_000);
});

describe("the public snapshot leaves out the operator's status text", () => {
  it("B4: neither the JSON nor the first SSE event carries playout.message", async () => {
    const body = await (await GET(request("10.2.0.1"))).text();
    expect(body).not.toContain(NOTE);
    const parsed = JSON.parse(body) as { playout: Record<string, unknown> };
    expect(Object.keys(parsed.playout).sort()).toEqual(["currentTitle", "overrideMode", "status", "transitionState"]);

    const abort = new AbortController();
    const stream = await streamGET(new Request("http://localhost/api/channel/live/stream", { signal: abort.signal }));
    const reader = stream.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    abort.abort();
    await reader.cancel().catch(() => undefined);

    expect(first).toContain("event: state");
    expect(first).toContain('"playout":{');
    expect(first).not.toContain(NOTE);
  });
});

describe("the documented contract (docs/operations.md)", () => {
  const doc = readFileSync(new URL("../../docs/operations.md", import.meta.url), "utf8");

  function contractRows() {
    const start = doc.indexOf("### The public status JSON: `/api/channel/live`");
    expect(start).toBeGreaterThan(-1);
    const end = doc.indexOf("\n### ", start + 4);
    return doc
      .slice(start, end === -1 ? undefined : end)
      .split("\n")
      .filter((line) => /^\| `[^`]+` \|/.test(line))
      .map((line) => ({ path: /^\| `([^`]+)`/.exec(line)![1], removed: /removed in M128/i.test(line) }));
  }

  function has(value: unknown, path: string) {
    let current = value;
    for (const part of path.split(".")) {
      if (current === null || typeof current !== "object" || !(part in current)) {
        return false;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return true;
  }

  it("B5: every field the table calls stable is in the snapshot, and playout.message is named as removed", () => {
    const snapshot = getPublicChannelSnapshot(seedState());
    const rows = contractRows();

    expect(rows.filter((row) => row.removed).map((row) => row.path)).toEqual(["playout.message"]);
    const stable = rows.filter((row) => !row.removed).map((row) => row.path);
    expect(stable.length).toBeGreaterThanOrEqual(15);
    expect(stable.filter((path) => !has(snapshot, path))).toEqual([]);
    expect(has(snapshot, "playout.message")).toBe(false);
  });
});
